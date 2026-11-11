-- Assign a task by email from the dashboard panel.
--  - Someone already in SS Tasks: added to the task's project (as a guest of
--    its workspace if they aren't a member yet) and assigned at once; they
--    get the usual notification.
--  - Someone not in SS Tasks yet: a guest invite to the task's project is
--    made (or an open one reused) and the assignment waits in
--    pending_assignments; it is applied as soon as they join the project.
-- Adding a new person needs the owner to be an owner/admin of that workspace.

create table if not exists public.pending_assignments (
  email text not null check (email = lower(email)),
  task_id uuid not null references public.tasks (id) on delete cascade,
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (email, task_id)
);
alter table public.pending_assignments enable row level security;
revoke all on public.pending_assignments from anon, authenticated;

-- When someone joins a project, give them the tasks waiting for their email there.
create or replace function public.apply_pending_assignments()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := (select lower(email) from public.profiles where id = new.user_id);
begin
  insert into public.task_assignees (task_id, user_id, assigned_by)
  select pa.task_id, new.user_id, pa.invited_by
    from public.pending_assignments pa
    join public.tasks t on t.id = pa.task_id
   where pa.email = v_email and t.project_id = new.project_id
  on conflict do nothing;
  delete from public.pending_assignments pa
   using public.tasks t
   where t.id = pa.task_id and pa.email = v_email and t.project_id = new.project_id;
  return new;
end;
$$;
drop trigger if exists project_members_pending on public.project_members;
create trigger project_members_pending after insert on public.project_members
  for each row execute function public.apply_pending_assignments();

create or replace function public.dashboard_task_assign_email(p_key text, p_task uuid, p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_project uuid;
  v_ws uuid;
  v_user uuid;
  v_name text;
  v_token text;
  v_result jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    select t.project_id, p.workspace_id into v_project, v_ws from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_task;
    select id, coalesce(nullif(full_name, ''), email) into v_user, v_name from public.profiles where lower(email) = v_email;

    if v_user is not null and exists (
      select 1 from public.workspace_members wm where wm.workspace_id = v_ws and wm.user_id = v_user
        and (wm.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = v_project and pm.user_id = v_user))
    ) then
      insert into public.task_assignees (task_id, user_id, assigned_by) values (p_task, v_user, v_me) on conflict do nothing;
      v_result := jsonb_build_object('status', 'assigned', 'name', v_name);
    else
      if not public.is_ws_admin(v_ws) then
        raise exception 'Only an owner or admin of this workspace can add new people.';
      end if;
      if v_user is not null then
        -- In SS Tasks already: add them to this project as a guest, then assign.
        insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_user, 'guest') on conflict do nothing;
        insert into public.project_members (project_id, user_id) values (v_project, v_user) on conflict do nothing;
        insert into public.task_assignees (task_id, user_id, assigned_by) values (p_task, v_user, v_me) on conflict do nothing;
        v_result := jsonb_build_object('status', 'assigned', 'name', v_name, 'added', true);
      else
        -- Not in SS Tasks yet: invite them to this project; the task waits for them.
        select token into v_token from public.invitations
         where email = v_email and project_id = v_project and accepted_at is null and expires_at > now()
         order by created_at desc limit 1;
        if v_token is null then
          insert into public.invitations (project_id, email, role, invited_by)
          values (v_project, v_email, 'guest', v_me) returning token into v_token;
        end if;
        insert into public.pending_assignments (email, task_id, invited_by) values (v_email, p_task, v_me) on conflict do nothing;
        v_result := jsonb_build_object('status', 'invited', 'email', v_email, 'token', v_token);
      end if;
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_result;
end;
$$;
revoke all on function public.dashboard_task_assign_email(text, uuid, text) from public;
grant execute on function public.dashboard_task_assign_email(text, uuid, text) to anon, authenticated;

-- "+ Project" from the dashboard: the workspaces the owner can add projects
-- to (owner / admin / member, not guest), and creating one there.
create or replace function public.dashboard_workspaces(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.home_dashboard_owner();
begin
  perform public.home_dashboard_check(p_key);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'color', w.color) order by w.name)
      from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id and m.user_id = v_me and m.role <> 'guest'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.dashboard_workspaces(text) from public;
grant execute on function public.dashboard_workspaces(text) to anon, authenticated;

create or replace function public.dashboard_project_create(p_key text, p_workspace uuid, p_name text, p_color text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_id uuid;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'A project needs a name.'; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace and user_id = v_me and role <> 'guest') then
    raise exception 'You cannot add projects to that workspace.';
  end if;
  insert into public.projects (workspace_id, name, color, created_by)
  values (p_workspace, left(trim(p_name), 120), coalesce(nullif(p_color, ''), '#0ea5e9'), v_me)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.dashboard_project_create(text, uuid, text, text) from public;
grant execute on function public.dashboard_project_create(text, uuid, text, text) to anon, authenticated;
