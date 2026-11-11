-- Assigning tasks from inside the company ERPs (RMI, MBL, …).
--  * erp_my_tasks now also returns, per project, the people who can be
--    assigned there; per task, the assignees' ids; and whether the user may
--    add new people (workspace owner/admin).
--  * erp_task_add: add a task assigned to chosen people (default: me).
--  * erp_task_assign: assign / unassign a person on a task.
--  * erp_task_assign_email: assign by email; someone not on the project is
--    added (admins only), someone not in Task Hub yet gets an invite and the
--    task waits for them (pending_assignments).
-- Everything runs as the ERP user (impersonated) and only inside the key's
-- workspace, like the other erp_* functions.

create or replace function public.erp_project_people(p_project uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.email), 'email', pr.email)
                            order by coalesce(nullif(pr.full_name, ''), pr.email)), '[]'::jsonb)
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    join public.profiles pr on pr.id = wm.user_id
   where p.id = p_project
     and (wm.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = wm.user_id));
$$;
revoke all on function public.erp_project_people(uuid) from public, anon, authenticated;

create or replace function public.erp_my_tasks(p_key text, p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_role public.member_role;
begin
  select role into v_role from public.workspace_members where workspace_id = v_ws and user_id = v_me;
  if v_me is null or v_role is null then
    return jsonb_build_object('workspace', (select name from public.workspaces where id = v_ws), 'member', false, 'tasks', '[]'::jsonb, 'projects', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'workspace', (select name from public.workspaces where id = v_ws),
    'member', true,
    'me', v_me,
    'can_invite', v_role in ('owner', 'admin'),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'people', public.erp_project_people(p.id)) order by p.name)
        from public.projects p
       where p.workspace_id = v_ws and not p.archived
         and (v_role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_me))
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'due', t.due_date, 'priority', t.priority,
               'project_id', p.id, 'project', p.name, 'color', p.color,
               'bucket', (select b.name from public.buckets b where b.id = t.bucket_id),
               'mine', exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_me),
               'assignees', (select coalesce(jsonb_agg(coalesce(nullif(pr.full_name, ''), pr.email) order by pr.full_name), '[]'::jsonb)
                               from public.task_assignees a join public.profiles pr on pr.id = a.user_id where a.task_id = t.id),
               'assignee_ids', (select coalesce(jsonb_agg(a.user_id), '[]'::jsonb) from public.task_assignees a where a.task_id = t.id),
               'pending', (select coalesce(jsonb_agg(pa.email order by pa.email), '[]'::jsonb) from public.pending_assignments pa where pa.task_id = t.id),
               'checks', (select count(*) from public.checklist_items c where c.task_id = t.id),
               'checked', (select count(*) from public.checklist_items c where c.task_id = t.id and c.done))
             order by t.due_date nulls last, t.created_at)
        from public.tasks t
        join public.projects p on p.id = t.project_id and p.workspace_id = v_ws and not p.archived
       where not t.done
         and (v_role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_me))
         and (exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_me)
              or (t.created_by = v_me and (exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id <> v_me)
                                           or exists (select 1 from public.pending_assignments pa where pa.task_id = t.id))))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.erp_my_tasks(text, text) from public;
grant execute on function public.erp_my_tasks(text, text) to anon, authenticated;

-- The task, checked to be in the key's workspace and visible to the user
-- (call after impersonating). Returns its project.
create or replace function public.erp_task_project(p_ws uuid, p_task uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_project uuid;
begin
  select t.project_id into v_project from public.tasks t join public.projects p on p.id = t.project_id
   where t.id = p_task and p.workspace_id = p_ws;
  if v_project is null or not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
  return v_project;
end;
$$;
revoke all on function public.erp_task_project(uuid, uuid) from public, anon, authenticated;

create or replace function public.erp_can_assign(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members wm join public.projects p on p.workspace_id = wm.workspace_id and p.id = p_project
     where wm.user_id = p_user
       and (wm.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = p_user)));
$$;
revoke all on function public.erp_can_assign(uuid, uuid) from public, anon, authenticated;

-- Add a task assigned to the chosen people (none chosen: the user).
create or replace function public.erp_task_add(p_key text, p_email text, p_project uuid, p_title text, p_due date, p_assignees uuid[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_people uuid[] := coalesce(p_assignees, '{}');
  v_bucket uuid;
  v_id uuid;
  v_u uuid;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'A task needs a title.'; end if;
  if not exists (select 1 from public.projects where id = p_project and workspace_id = v_ws) then raise exception 'Project not found.'; end if;
  if cardinality(v_people) = 0 then v_people := array[v_me]; end if;
  if cardinality(v_people) > 20 then raise exception 'Too many people on one task.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    foreach v_u in array v_people loop
      if not public.erp_can_assign(p_project, v_u) then raise exception 'Someone you chose is not on this project.'; end if;
    end loop;
    select id into v_bucket from public.buckets where project_id = p_project order by position limit 1;
    insert into public.tasks (project_id, bucket_id, title, due_date, created_by, position)
    values (p_project, v_bucket, left(trim(p_title), 300), p_due, v_me, extract(epoch from now()))
    returning id into v_id;
    insert into public.task_assignees (task_id, user_id, assigned_by)
    select v_id, u, v_me from unnest(v_people) u on conflict do nothing;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_id;
end;
$$;
revoke all on function public.erp_task_add(text, text, uuid, text, date, uuid[]) from public;
grant execute on function public.erp_task_add(text, text, uuid, text, date, uuid[]) to anon, authenticated;

-- Assign (p_on) or unassign a person on a task.
create or replace function public.erp_task_assign(p_key text, p_email text, p_task uuid, p_user uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_project uuid;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    v_project := public.erp_task_project(v_ws, p_task);
    if p_on then
      if not public.erp_can_assign(v_project, p_user) then raise exception 'That person is not on this project.'; end if;
      insert into public.task_assignees (task_id, user_id, assigned_by) values (p_task, p_user, v_me) on conflict do nothing;
    else
      delete from public.task_assignees where task_id = p_task and user_id = p_user;
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.erp_task_assign(text, text, uuid, uuid, boolean) from public;
grant execute on function public.erp_task_assign(text, text, uuid, uuid, boolean) to anon, authenticated;

-- Assign by email. Returns {status: 'assigned', name, added?} or
-- {status: 'invited', email, token} (the app's /join/<token> link).
create or replace function public.erp_task_assign_email(p_key text, p_email text, p_task uuid, p_to text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_email text := lower(trim(coalesce(p_to, '')));
  v_project uuid;
  v_user uuid;
  v_name text;
  v_token text;
  v_result jsonb;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    v_project := public.erp_task_project(v_ws, p_task);
    select id, coalesce(nullif(full_name, ''), email) into v_user, v_name from public.profiles where lower(email) = v_email;
    if v_user is not null and public.erp_can_assign(v_project, v_user) then
      insert into public.task_assignees (task_id, user_id, assigned_by) values (p_task, v_user, v_me) on conflict do nothing;
      v_result := jsonb_build_object('status', 'assigned', 'name', v_name);
    else
      if not public.is_ws_admin(v_ws) then
        raise exception 'Only an owner or admin of this workspace can add new people. Ask them to invite %.', v_email;
      end if;
      if v_user is not null then
        insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_user, 'guest') on conflict do nothing;
        insert into public.project_members (project_id, user_id) values (v_project, v_user) on conflict do nothing;
        insert into public.task_assignees (task_id, user_id, assigned_by) values (p_task, v_user, v_me) on conflict do nothing;
        v_result := jsonb_build_object('status', 'assigned', 'name', v_name, 'added', true);
      else
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
revoke all on function public.erp_task_assign_email(text, text, uuid, text) from public;
grant execute on function public.erp_task_assign_email(text, text, uuid, text) to anon, authenticated;
