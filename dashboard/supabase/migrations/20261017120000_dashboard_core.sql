-- Personal dashboard: icons, report cards, settings and the owner whitelist.
-- Every table has Row Level Security on, and every policy goes through
-- is_dashboard_owner(), so only the whitelisted email can read or write.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Owner whitelist
-- ---------------------------------------------------------------------------
create table if not exists public.dashboard_owners (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.dashboard_owners enable row level security;
-- No policies: the table is invisible to the API. Manage it from the SQL editor.

create or replace function public.is_dashboard_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dashboard_owners
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_dashboard_owner() from public;
grant execute on function public.is_dashboard_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Icons on the home screen
-- ---------------------------------------------------------------------------
create table if not exists public.dashboard_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  url text not null check (url ~* '^https?://'),
  icon text,                         -- initials / emoji, or an image URL
  color text not null default '#4f46e5' check (color ~* '^#[0-9a-f]{6}$'),
  category text not null default 'project' check (category in ('project', 'personal')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_apps_order_idx
  on public.dashboard_apps (category, sort_order);

drop trigger if exists dashboard_apps_touch on public.dashboard_apps;
create trigger dashboard_apps_touch before update on public.dashboard_apps
  for each row execute function public.dashboard_touch_updated_at();

-- ---------------------------------------------------------------------------
-- KPI cards
-- ---------------------------------------------------------------------------
-- query_type:
--   count        number of rows in table_name matching filter
--   sum          sum of value_column over matching rows
--   rpc          call the Postgres function named in table_name; it must
--                return a number, or json {"value": n, "previous": n}
--   placeholder  show sample_value / sample_previous (not connected yet)
-- date_range narrows count/sum by date_column (Asia/Karachi):
--   all | today | this_month
-- filter is a JSON array of {"column", "op", "value"};
--   op is one of eq, neq, gt, gte, lt, lte, is, in, like, ilike
create table if not exists public.dashboard_cards (
  id uuid primary key default gen_random_uuid(),
  project text not null check (project ~ '^[A-Z][A-Z0-9_]*$'),
  title text not null check (length(trim(title)) > 0),
  query_type text not null default 'placeholder'
    check (query_type in ('count', 'sum', 'rpc', 'placeholder')),
  table_name text check (table_name is null or table_name ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  value_column text check (value_column is null or value_column ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  date_column text check (date_column is null or date_column ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  date_range text not null default 'all' check (date_range in ('all', 'today', 'this_month')),
  filter jsonb not null default '[]'::jsonb check (jsonb_typeof(filter) = 'array'),
  format text not null default 'number' check (format in ('number', 'currency', 'percent')),
  sample_value numeric,
  sample_previous numeric,
  higher_is_better boolean not null default true,  -- colours the trend arrow
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_cards_order_idx
  on public.dashboard_cards (project, sort_order);

drop trigger if exists dashboard_cards_touch on public.dashboard_cards;
create trigger dashboard_cards_touch before update on public.dashboard_cards
  for each row execute function public.dashboard_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Key/value settings (display name, calendar embed URL, ...)
-- ---------------------------------------------------------------------------
create table if not exists public.dashboard_settings (
  key text primary key check (key ~ '^[a-z_]+$'),
  value jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_settings_touch on public.dashboard_settings;
create trigger dashboard_settings_touch before update on public.dashboard_settings
  for each row execute function public.dashboard_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.dashboard_apps enable row level security;
alter table public.dashboard_cards enable row level security;
alter table public.dashboard_settings enable row level security;

drop policy if exists "owner full access" on public.dashboard_apps;
create policy "owner full access" on public.dashboard_apps
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

drop policy if exists "owner full access" on public.dashboard_cards;
create policy "owner full access" on public.dashboard_cards
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

drop policy if exists "owner full access" on public.dashboard_settings;
create policy "owner full access" on public.dashboard_settings
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_apps, public.dashboard_cards, public.dashboard_settings from anon;
grant select, insert, update, delete
  on public.dashboard_apps, public.dashboard_cards, public.dashboard_settings
  to authenticated;
