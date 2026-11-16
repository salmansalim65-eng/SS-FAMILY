-- Messages SS still has to answer (mostly WhatsApp, shared to the dashboard
-- from Android's Share menu). Owner-only, like the other dashboard tables.

create table if not exists public.dashboard_replies (
  id uuid primary key default gen_random_uuid(),
  sender text not null default '' check (length(sender) <= 120),
  message text not null default '' check (length(message) <= 4000),
  source text not null default 'whatsapp' check (source in ('whatsapp', 'other')),
  due date,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(sender)) > 0 or length(trim(message)) > 0)
);

create index if not exists dashboard_replies_open_idx on public.dashboard_replies (done, due nulls last, created_at);

drop trigger if exists dashboard_replies_touch on public.dashboard_replies;
create trigger dashboard_replies_touch before update on public.dashboard_replies
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_replies enable row level security;

drop policy if exists "owner full access" on public.dashboard_replies;
create policy "owner full access" on public.dashboard_replies
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_replies from anon;
grant select, insert, update, delete on public.dashboard_replies to authenticated;
