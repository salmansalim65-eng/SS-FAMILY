-- ============================================================================
-- SS-FAMILY :: Family Guest Management & Event Planning System
-- Core schema: roles, guests, menu, tasks, shopping, notifications, activity
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Clean up the earlier empty draft tables (all had 0 rows).
-- `products` / `orders` belong to an unrelated scaffold and are left alone.
-- ---------------------------------------------------------------------------
drop view  if exists public.shopping_consolidated cascade;
drop table if exists public.guest_expenses   cascade;
drop table if exists public.menu_items       cascade;
drop table if exists public.menu_planning    cascade;
drop table if exists public.household_tasks  cascade;
drop table if exists public.tasks            cascade;
drop table if exists public.shopping_list    cascade;
drop table if exists public.guests           cascade;
drop table if exists public.family_members   cascade;
drop table if exists public.notifications    cascade;
drop table if exists public.activity_log     cascade;
drop table if exists public.users            cascade;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('head', 'member', 'driver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.menu_status as enum ('draft', 'approved', 'in_progress', 'completed', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('pending', 'in_progress', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.priority_level as enum ('high', 'medium', 'low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.shop_status as enum ('pending', 'purchased', 'verified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.prep_type as enum ('homemade', 'outside');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- users  (profile row mirrored from auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id              uuid primary key references auth.users (id) on delete cascade,
  name            text not null,
  email           text not null unique,
  phone           text,
  whatsapp_number text,
  role            public.user_role not null default 'member',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- guests
-- ---------------------------------------------------------------------------
create table public.guests (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  arrival_date              date not null,
  departure_date            date,
  male_count                integer not null default 0 check (male_count >= 0),
  female_count              integer not null default 0 check (female_count >= 0),
  relationship              text,
  room                      text,
  special_needs             text,
  phone                     text,
  origin_city               text default 'Pakistan',
  google_calendar_event_id  text,
  google_calendar_html_link text,
  created_by                uuid references public.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  total_guests              integer generated always as (male_count + female_count) stored,
  constraint guests_dates_ok     check (departure_date is null or departure_date >= arrival_date),
  constraint guests_headcount_ok check (male_count + female_count > 0)
);

create index guests_arrival_idx on public.guests (arrival_date);

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------
create table public.menu_items (
  id                  uuid primary key default gen_random_uuid(),
  dish_name           text not null,
  meal_type           text not null default 'dinner'
                      check (meal_type in ('breakfast','lunch','dinner','snacks','dessert')),
  serve_date          date,
  guest_id            uuid references public.guests (id) on delete set null,
  suggested_by        uuid references public.users (id) on delete set null,
  status              public.menu_status not null default 'draft',
  approved_by         uuid references public.users (id) on delete set null,
  approver_date       timestamptz,
  rejection_reason    text,
  cook_person         uuid references public.users (id) on delete set null,
  homemade_or_outside public.prep_type not null default 'homemade',
  outside_responsible uuid references public.users (id) on delete set null,
  quantity            numeric(10,2) not null default 1 check (quantity > 0),
  unit                text default 'serving',
  cost                numeric(12,2) not null default 0 check (cost >= 0),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index menu_items_status_idx on public.menu_items (status);
create index menu_items_serve_idx  on public.menu_items (serve_date);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  task_type    text not null default 'household'
               check (task_type in ('menu','household','shopping','guest')),
  assigned_to  uuid references public.users (id) on delete set null,
  due_date     date,
  due_time     time,
  priority     public.priority_level not null default 'medium',
  status       public.task_status not null default 'pending',
  menu_item_id uuid references public.menu_items (id) on delete cascade,
  guest_id     uuid references public.guests (id) on delete set null,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index tasks_assignee_idx on public.tasks (assigned_to);
create index tasks_due_idx      on public.tasks (due_date);
create unique index tasks_menu_item_uniq on public.tasks (menu_item_id) where menu_item_id is not null;

-- ---------------------------------------------------------------------------
-- shopping_list
-- ---------------------------------------------------------------------------
create table public.shopping_list (
  id           uuid primary key default gen_random_uuid(),
  item_name    text not null,
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  unit         text not null default 'pcs',
  category     text not null default 'Other',
  added_by     uuid references public.users (id) on delete set null,
  status       public.shop_status not null default 'pending',
  priority     public.priority_level not null default 'medium',
  notes        text,
  guest_id     uuid references public.guests (id) on delete set null,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  purchased_by uuid references public.users (id) on delete set null,
  purchased_at timestamptz,
  verified_by  uuid references public.users (id) on delete set null,
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  normalized_name text generated always as
    (lower(btrim(regexp_replace(item_name, '\s+', ' ', 'g')))) stored
);

create index shopping_norm_idx    on public.shopping_list (normalized_name);
create index shopping_trgm_idx    on public.shopping_list using gin (normalized_name gin_trgm_ops);
create index shopping_status_idx  on public.shopping_list (status);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  type            text not null
                  check (type in ('guest_added','menu_suggested','menu_approved','menu_changed',
                                  'task_assigned','task_due','task_completed',
                                  'shopping_updated','shopping_purchased','guest_arriving')),
  title           text not null,
  message         text not null,
  entity_type     text,
  entity_id       uuid,
  link            text,
  sent_via        text[] not null default array['in_app'],
  whatsapp_status text not null default 'not_sent'
                  check (whatsapp_status in ('not_sent','queued','sent','failed','disabled')),
  whatsapp_error  text,
  sent_at         timestamptz not null default now(),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_user_idx    on public.notifications (user_id, read_at);
create index notifications_created_idx on public.notifications (created_at desc);
create index notifications_wa_idx      on public.notifications (whatsapp_status) where whatsapp_status = 'queued';

-- ---------------------------------------------------------------------------
-- activity_log  ("who did what and when")
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.users (id) on delete set null,
  actor_name   text,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  entity_label text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index activity_created_idx on public.activity_log (created_at desc);
