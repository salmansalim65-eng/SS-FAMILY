-- Run in the VISTA Supabase project (not the dashboard project).
--
-- Numbers for the VISTA cards on the personal dashboard. Every function
-- demands a shared secret (p_key) whose SHA-256 hash lives in a table the API
-- cannot read, because VISTA's anon key ships in its web app. Put the secret
-- itself in the dashboard's VISTA_DASHBOARD_KEY env variable, and store its hash:
--   insert into public.home_dashboard_key (key_hash)
--   values (encode(sha256(convert_to('<the secret>', 'UTF8')), 'hex'))
--   on conflict (id) do update set key_hash = excluded.key_hash;
--
-- "Today" is Asia/Riyadh. Amounts are in the base currency (SAR).

create table if not exists public.home_dashboard_key (
  id boolean primary key default true check (id),
  key_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.home_dashboard_key enable row level security;
revoke all on public.home_dashboard_key from public, anon, authenticated;

create or replace function public.home_dashboard_check(p_key text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_key is null or not exists (
    select 1 from public.home_dashboard_key
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'home dashboard key is not valid' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.home_dashboard_check(text) from public, anon, authenticated;

create or replace function public.home_dashboard_today()
returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- Pilgrims in the Kingdom today (visa groups not rejected), vs the same day last month.
create or replace function public.home_dashboard_pilgrims(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  prev date := (d - interval '1 month')::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(pax), 0) from umrah_groups
              where coalesce(workflow_status, '') <> 'rejected' and arrival_date <= d and departure_date >= d),
    'previous', (select coalesce(sum(pax), 0) from umrah_groups
                 where coalesce(workflow_status, '') <> 'rejected' and arrival_date <= prev and departure_date >= prev)
  );
end;
$$;

-- Transport trips scheduled today (not cancelled), vs the same day last month.
create or replace function public.home_dashboard_trips_today(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  prev date := (d - interval '1 month')::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from transport_trips where trip_date = d and status <> 'cancelled'),
    'previous', (select count(*) from transport_trips where trip_date = prev and status <> 'cancelled')
  );
end;
$$;

-- Open receivable items, in base currency (SAR).
create or replace function public.home_dashboard_receivables(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(outstanding_base), 0) from open_items where direction = 'D' and status = 'open'),
    'previous', null
  );
end;
$$;

-- Vouchers still waiting for approval.
create or replace function public.home_dashboard_pending_vouchers(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from pending_vouchers
              where status not in ('authorized', 'rejected', 'withdrawn', 'cancelled')),
    'previous', null
  );
end;
$$;

revoke all on function public.home_dashboard_pilgrims(text),
                       public.home_dashboard_trips_today(text),
                       public.home_dashboard_receivables(text),
                       public.home_dashboard_pending_vouchers(text)
  from public;
grant execute on function public.home_dashboard_pilgrims(text),
                          public.home_dashboard_trips_today(text),
                          public.home_dashboard_receivables(text),
                          public.home_dashboard_pending_vouchers(text)
  to anon, authenticated;
