-- A colour per task list for the Tasks panel's heading strips. Google Tasks
-- has no list colours, so the dashboard keeps them here by list id. Owner-only.
create table if not exists public.dashboard_list_colors (
  list_id text primary key check (length(list_id) between 1 and 200),
  color text not null check (color in ('blue', 'purple', 'green', 'yellow', 'pink', 'teal', 'orange', 'gray', 'indigo', 'red')),
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_list_colors_touch on public.dashboard_list_colors;
create trigger dashboard_list_colors_touch before update on public.dashboard_list_colors
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_list_colors enable row level security;

drop policy if exists "owner full access" on public.dashboard_list_colors;
create policy "owner full access" on public.dashboard_list_colors
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_list_colors from anon;
grant select, insert, update, delete on public.dashboard_list_colors to authenticated;
