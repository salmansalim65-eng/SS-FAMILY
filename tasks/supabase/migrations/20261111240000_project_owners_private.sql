-- Projects belong to whoever made them, and are private by default.
--  * project_members.role: 'owner' | 'member'. The creator is the owner; an
--    owner can make other members owners. The last owner can't be removed.
--  * Only project members open a project — workspace owners/admins no longer
--    see every project automatically. Inside a project, members see their own
--    tasks and project owners see all of them.
--  * Managing a project (people, settings, delete, share, inviting new
--    people, deleting others' tasks or files) is for its owners.
--  * Safety: a workspace owner sees the NAMES of projects they aren't in
--    (workspace_hidden_projects) and can take one over (take_over_project);
--    each take-over is recorded in project_takeovers and shown in the project.
-- Everyone already in a project keeps it (the owner of every workspace was
-- added to every existing project earlier).

alter table public.project_members add column if not exists role text not null default 'member';
alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members add constraint project_members_role_check check (role in ('owner', 'member'));

-- Existing projects: the creator owns it (added if missing); a project with
-- no creator in it gets its earliest member as owner.
insert into public.project_members (project_id, user_id, role)
select p.id, p.created_by, 'owner' from public.projects p
 where p.created_by is not null and exists (select 1 from public.profiles pr where pr.id = p.created_by)
on conflict (project_id, user_id) do update set role = 'owner';
update public.project_members pm set role = 'owner'
 where not exists (select 1 from public.project_members o where o.project_id = pm.project_id and o.role = 'owner')
   and pm.user_id = (select m.user_id from public.project_members m where m.project_id = pm.project_id order by m.added_at, m.user_id limit 1);

create or replace function public.is_project_owner(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project and user_id = p_user and role = 'owner');
$$;
revoke all on function public.is_project_owner(uuid, uuid) from public, anon;
grant execute on function public.is_project_owner(uuid, uuid) to authenticated;

-- Who can open a project: its members (who must still be in the workspace).
create or replace function public.project_access(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members pm
      join public.projects p on p.id = pm.project_id
      join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = pm.user_id
     where pm.project_id = p_project and pm.user_id = p_user);
$$;

create or replace function public.can_manage_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_project_owner(p_project, auth.uid()) and public.can_see_project(p_project);
$$;

create or replace function public.can_see_task_row(p_project uuid, p_created_by uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_project(p_project)
     and (p_created_by = auth.uid()
          or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid())
          or public.is_project_owner(p_project, auth.uid()));
$$;

create or replace function public.can_remove_attachment(p_task uuid, p_uploader uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_task(p_task)
     and (p_uploader = auth.uid()
          or public.is_project_owner((select project_id from public.tasks where id = p_task), auth.uid()));
$$;

-- The creator joins their new project as its owner.
create or replace function public.project_creator_joins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id, role) values (new.id, new.created_by, 'owner')
    on conflict (project_id, user_id) do update set role = 'owner';
  end if;
  return new;
end;
$$;

-- A project always keeps at least one owner (unless the project itself goes).
create or replace function public.project_keep_an_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from public.projects where id = old.project_id)
     and not exists (select 1 from public.project_members where project_id = old.project_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'A project needs at least one owner — make someone else owner first.';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists project_members_keep_owner on public.project_members;
create trigger project_members_keep_owner before update or delete on public.project_members
  for each row execute function public.project_keep_an_owner();

-- Policies that used the workspace admin.
drop policy if exists "admins delete projects" on public.projects;
create policy "admins delete projects" on public.projects for delete
  using (public.is_project_owner(id, auth.uid()));
drop policy if exists "delete tasks" on public.tasks;
create policy "delete tasks" on public.tasks for delete
  using (created_by = auth.uid() or public.is_project_owner(project_id, auth.uid()));

-- Functions that spelled out "workspace owner/admin": now the project owner.
-- Patched from their live bodies so nothing else in them changes.
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('dashboard_task_assign_email', 'erp_task_assign_email', 'dashboard_project_share', 'erp_task_delete', 'task_hub_detail')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    if r.proname in ('dashboard_task_assign_email', 'erp_task_assign_email') then
      v_new := replace(v_new, 'if not public.is_ws_admin(v_ws) then', 'if not public.can_manage_project(v_project) then');
      v_new := replace(v_new, 'Only an owner or admin of this workspace can add new people', 'Only the project owner can add new people');
    elsif r.proname = 'dashboard_project_share' then
      v_new := replace(v_new, 'if not public.is_ws_admin(v_ws) then raise exception ''Only an owner or admin of this workspace can share it.''',
                              'if not public.can_manage_project(p_project) then raise exception ''Only the project owner can share it.''');
    elsif r.proname = 'erp_task_delete' then
      v_new := replace(v_new, 'and not public.is_ws_admin(v_ws) then', 'and not public.is_project_owner(v_task.project_id, v_me) then');
      v_new := replace(v_new, 'or a workspace owner/admin, can delete it', 'or the project owner, can delete it');
    elsif r.proname = 'task_hub_detail' then
      v_new := replace(v_new, '''can_delete'', t.created_by = v_me or public.is_ws_admin(v_ws)', '''can_delete'', t.created_by = v_me or public.is_project_owner(t.project_id, v_me)');
    end if;
    if v_new = v_def then raise exception 'Could not patch %', r.proname; end if;
    execute v_new;
  end loop;
end;
$$;

-- Safety: take-overs by the workspace owner.
create table if not exists public.project_takeovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.project_takeovers enable row level security;
drop policy if exists "see take-overs" on public.project_takeovers;
create policy "see take-overs" on public.project_takeovers for select to authenticated
  using (public.can_see_project(project_id));
grant select on public.project_takeovers to authenticated;

-- Projects in a workspace the caller (its owner) is not in: names only.
create or replace function public.workspace_hidden_projects(p_ws uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.ws_role(p_ws) = 'owner' then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'color', p.color,
             'owners', (select coalesce(jsonb_agg(coalesce(nullif(pr.full_name, ''), pr.email)), '[]'::jsonb)
                          from public.project_members pm join public.profiles pr on pr.id = pm.user_id
                         where pm.project_id = p.id and pm.role = 'owner'))
           order by p.name)
      from public.projects p
     where p.workspace_id = p_ws and not p.archived
       and not exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid())
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;
revoke all on function public.workspace_hidden_projects(uuid) from public, anon;
grant execute on function public.workspace_hidden_projects(uuid) to authenticated;

create or replace function public.take_over_project(p_project uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.projects where id = p_project;
  if v_ws is null then raise exception 'Project not found.'; end if;
  if public.ws_role(v_ws) is distinct from 'owner' then raise exception 'Only the workspace owner can take over a project.'; end if;
  insert into public.project_members (project_id, user_id, role) values (p_project, auth.uid(), 'owner')
  on conflict (project_id, user_id) do update set role = 'owner';
  insert into public.project_takeovers (project_id, user_id) values (p_project, auth.uid());
end;
$$;
revoke all on function public.take_over_project(uuid) from public, anon;
grant execute on function public.take_over_project(uuid) to authenticated;
