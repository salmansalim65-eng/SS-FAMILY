-- A colour per task for the Tasks panel. Google Tasks has no colour of its
-- own, so the dashboard keeps it here by the task's id. Owner-only.
create table if not exists public.dashboard_task_colors (
  task_id text primary key check (length(task_id) between 1 and 200),
  color text not null check (color in ('yellow', 'pink', 'green', 'blue', 'purple', 'orange')),
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_task_colors_touch on public.dashboard_task_colors;
create trigger dashboard_task_colors_touch before update on public.dashboard_task_colors
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_task_colors enable row level security;

drop policy if exists "owner full access" on public.dashboard_task_colors;
create policy "owner full access" on public.dashboard_task_colors
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_task_colors from anon;
grant select, insert, update, delete on public.dashboard_task_colors to authenticated;
