-- Guests (people from outside, added by email to one task) see only their own
-- tasks in a project: the ones they created, are assigned to, or whose bucket
-- they are a member of. Workspace members still see every task in the
-- projects they are in (20261117090000); project owners see everything.
-- SS, 20/11/2026: "guest ko sirf apne tasks nazar aayein".

create or replace function public.can_see_task_row(p_project uuid, p_created_by uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_project(p_project)
     and (
       not exists (select 1 from public.projects p
                     join public.workspace_members wm on wm.workspace_id = p.workspace_id
                    where p.id = p_project and wm.user_id = auth.uid() and wm.role = 'guest')
       or p_created_by = auth.uid()
       or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid())
       or exists (select 1 from public.tasks t join public.bucket_members bm on bm.bucket_id = t.bucket_id
                   where t.id = p_task and bm.user_id = auth.uid())
       or public.is_project_owner(p_project, auth.uid()));
$$;
revoke all on function public.can_see_task_row(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_see_task_row(uuid, uuid, uuid) to authenticated;
