-- A time of day for a task's due date. Google Tasks keeps only the date, so
-- the dashboard keeps the time here by the task's id. Owner-only.
create table if not exists public.dashboard_task_times (
  task_id text primary key check (length(task_id) between 1 and 200),
  due_time time not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_task_times_touch on public.dashboard_task_times;
create trigger dashboard_task_times_touch before update on public.dashboard_task_times
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_task_times enable row level security;

drop policy if exists "owner full access" on public.dashboard_task_times;
create policy "owner full access" on public.dashboard_task_times
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_task_times from anon;
grant select, insert, update, delete on public.dashboard_task_times to authenticated;
