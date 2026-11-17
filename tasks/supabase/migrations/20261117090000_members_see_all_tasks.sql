-- Every member of a project sees every task in it, assigned to them or not
-- (SS, 17/11/2026), like a Planner plan. Replaces the "members see only their
-- own tasks" rule (20261111160000, 20261111240000, 20261113100000).
-- Projects stay private: can_see_project is project membership, so people
-- outside a project still see none of it. can_see_task follows, so checklist,
-- comments, files and assignees open for every member too. Deleting someone
-- else's task stays with the creator and the project owners.

create or replace function public.can_see_task_row(p_project uuid, p_created_by uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_project(p_project);
$$;
revoke all on function public.can_see_task_row(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_see_task_row(uuid, uuid, uuid) to authenticated;
