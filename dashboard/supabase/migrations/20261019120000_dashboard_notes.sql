-- Sticky notes on the dashboard: plain text notes and checklists.
-- Owner-only, like the other dashboard tables.

create table if not exists public.dashboard_notes (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'text' check (kind in ('text', 'checklist')),
  title text not null default '' check (length(title) <= 200),
  body text not null default '' check (length(body) <= 10000),
  -- checklist items: [{"id": "...", "text": "...", "done": false}, ...]
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100),
  color text not null default 'yellow'
    check (color in ('yellow', 'pink', 'green', 'blue', 'purple', 'orange')),
  pinned boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_notes_order_idx
  on public.dashboard_notes (pinned desc, sort_order);

drop trigger if exists dashboard_notes_touch on public.dashboard_notes;
create trigger dashboard_notes_touch before update on public.dashboard_notes
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_notes enable row level security;

drop policy if exists "owner full access" on public.dashboard_notes;
create policy "owner full access" on public.dashboard_notes
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_notes from anon;
grant select, insert, update, delete on public.dashboard_notes to authenticated;
