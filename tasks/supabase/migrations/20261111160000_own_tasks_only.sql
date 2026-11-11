-- Members see only their own tasks. A workspace owner or admin sees every
-- task in the workspace; everyone else (member, guest) sees a task only when
-- it is assigned to them or they created it. Projects and buckets stay
-- visible as before, so people can still add tasks to them.
-- can_see_task drives checklist, comments and assignees, so those follow.

create or replace function public.can_see_task_row(p_project uuid, p_created_by uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_project(p_project)
     and (p_created_by = auth.uid()
          or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid())
          or public.is_ws_admin((select workspace_id from public.projects where id = p_project)));
$$;
revoke all on function public.can_see_task_row(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_see_task_row(uuid, uuid, uuid) to authenticated;

create or replace function public.can_see_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_see_task_row(t.project_id, t.created_by, t.id) from public.tasks t where t.id = p_task), false);
$$;

drop policy if exists "see tasks" on public.tasks;
create policy "see tasks" on public.tasks for select
  using (public.can_see_task_row(project_id, created_by, id));

drop policy if exists "edit tasks" on public.tasks;
create policy "edit tasks" on public.tasks for update
  using (public.can_see_task_row(project_id, created_by, id))
  with check (public.can_see_project(project_id));

drop policy if exists "delete tasks" on public.tasks;
create policy "delete tasks" on public.tasks for delete
  using (created_by = auth.uid()
         or public.is_ws_admin((select p.workspace_id from public.projects p where p.id = tasks.project_id)));
