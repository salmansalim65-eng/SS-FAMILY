-- Projects work like Teams channels: a workspace (team) has many people, but
-- a project (channel) is open only to the people added to it. Workspace
-- owners and admins can open every project. Inside a project, members still
-- see only their own tasks (20261111160000_own_tasks_only).
--  * project_access(project, user): owner/admin of the workspace, or a
--    project member.
--  * can_see_project / the projects policies use it.
--  * Whoever creates a project becomes its member.
--  * Adding / removing project people: workspace owner/admin or the project's
--    creator.
--  * People who can be given a task = people with access to the project.
--  * Existing projects: everyone already in the workspace is added to every
--    existing project, so nobody loses work today.

create or replace function public.project_access(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = p_user
     where p.id = p_project
       and (wm.role in ('owner', 'admin')
            or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = p_user)));
$$;
revoke all on function public.project_access(uuid, uuid) from public, anon;
grant execute on function public.project_access(uuid, uuid) to authenticated;

create or replace function public.can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.project_access(p_project, auth.uid());
$$;

-- Workspace owner/admin, or the project's creator, manage who is in it.
create or replace function public.can_manage_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project
       and (public.is_ws_admin(p.workspace_id) or (p.created_by = auth.uid() and public.can_see_project(p.id))));
$$;
revoke all on function public.can_manage_project(uuid) from public, anon;
grant execute on function public.can_manage_project(uuid) to authenticated;

drop policy if exists "see visible projects" on public.projects;
create policy "see visible projects" on public.projects for select
  using (public.can_see_project(id));

drop policy if exists "members edit projects" on public.projects;
create policy "members edit projects" on public.projects for update
  using (public.can_see_project(id) and public.ws_role(workspace_id) in ('owner', 'admin', 'member'));

drop policy if exists "members manage project people" on public.project_members;
create policy "members manage project people" on public.project_members for all
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id)
              and exists (select 1 from public.workspace_members wm join public.projects p on p.workspace_id = wm.workspace_id
                           where p.id = project_members.project_id and wm.user_id = project_members.user_id));

-- The creator joins their new project.
create or replace function public.project_creator_joins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id) values (new.id, new.created_by) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists projects_creator_joins on public.projects;
create trigger projects_creator_joins after insert on public.projects
  for each row execute function public.project_creator_joins();

-- Who can be given a task on a project.
create or replace function public.erp_can_assign(p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.project_access(p_project, p_user);
$$;
revoke all on function public.erp_can_assign(uuid, uuid) from public, anon, authenticated;

create or replace function public.erp_project_people(p_project uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.email), 'email', pr.email)
                            order by coalesce(nullif(pr.full_name, ''), pr.email)), '[]'::jsonb)
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    join public.profiles pr on pr.id = wm.user_id
   where p.id = p_project and public.project_access(p.id, wm.user_id);
$$;
revoke all on function public.erp_project_people(uuid) from public, anon, authenticated;

-- The same rule in the dashboard and ERP functions that spelled out the old
-- one (workspace members, plus guests added to the project). Patched from
-- their live bodies so nothing else in them changes.
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('dashboard_projects', 'dashboard_task_assign', 'dashboard_task_assign_email', 'erp_my_tasks')
  loop
    v_def := pg_get_functiondef(r.oid);
    -- someone else's access: (wm.role <> 'guest' or exists (… pmX.project_id = <proj> and pmX.user_id = <user>))
    v_new := regexp_replace(v_def,
      '\(wm\.role <> ''guest'' or exists \(select 1 from public\.project_members (\w+) where \1\.project_id = ([\w.]+) and \1\.user_id = ([\w.]+)\)\)',
      'public.project_access(\2, \3)', 'g');
    -- the caller's own access to project p: (m.role / v_role <> 'guest' or exists (… pm.user_id = v_me))
    v_new := regexp_replace(v_new,
      '\((?:m\.role|v_role) <> ''guest'' or exists \(select 1 from public\.project_members pm where pm\.project_id = p\.id and pm\.user_id = v_me\)\)',
      'public.project_access(p.id, v_me)', 'g');
    if v_new <> v_def then
      execute v_new;
    end if;
  end loop;
end;
$$;

-- Existing projects: add everyone already in the workspace (non-guests),
-- so today's work carries on; owners then remove whoever shouldn't be there.
insert into public.project_members (project_id, user_id)
select p.id, wm.user_id
  from public.projects p
  join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.role <> 'guest'
 where not p.archived
on conflict do nothing;
