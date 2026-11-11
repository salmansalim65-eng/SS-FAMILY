-- Creating a project failed with "new row violates row-level security
-- policy": INSERT … RETURNING checks the SELECT policy, and can_see_project
-- looks the project up in a snapshot that doesn't contain the new row yet.
-- The creator can always see their own project (they are also added as a
-- member by projects_creator_joins), so check that on the row itself first.

drop policy if exists "see visible projects" on public.projects;
create policy "see visible projects" on public.projects for select
  using (created_by = auth.uid() or public.can_see_project(id));
