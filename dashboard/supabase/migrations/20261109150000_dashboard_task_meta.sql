-- Planner-style priority for tasks (Urgent / Important / Medium / Low).
-- Google Tasks has none, so the dashboard keeps it here by the task's id.
-- Owner-only.
create table if not exists public.dashboard_task_meta (
  task_id text primary key check (length(task_id) between 1 and 200),
  priority text check (priority in ('urgent', 'important', 'medium', 'low')),
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_task_meta_touch on public.dashboard_task_meta;
create trigger dashboard_task_meta_touch before update on public.dashboard_task_meta
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_task_meta enable row level security;

drop policy if exists "owner full access" on public.dashboard_task_meta;
create policy "owner full access" on public.dashboard_task_meta
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_task_meta from anon;
grant select, insert, update, delete on public.dashboard_task_meta to authenticated;
