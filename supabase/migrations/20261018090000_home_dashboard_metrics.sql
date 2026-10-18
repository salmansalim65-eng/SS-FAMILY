-- Numbers for the personal home dashboard (the separate app in dashboard/).
--
-- The dashboard calls these over PostgREST with this project's anon key.
-- That key ships in the SS Family web bundle, so it is effectively public:
-- every function here also demands a shared secret (p_key), checked against
-- a hash in a table nobody can read through the API.
--
-- Set the secret once from the SQL editor (any long random string), and put
-- the same string in the dashboard's SS_FAMILY_DASHBOARD_KEY env variable:
--   insert into public.home_dashboard_key (key_hash)
--   values (encode(sha256(convert_to('<the secret>', 'UTF8')), 'hex'))
--   on conflict (id) do update set key_hash = excluded.key_hash;

create table if not exists public.home_dashboard_key (
  id boolean primary key default true check (id),   -- at most one row
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

-- "Today" is the family's day in Saudi Arabia.
create or replace function public.home_dashboard_today()
returns date
language sql stable
as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- People in the house today, vs the same day last month.
-- A visit with no departure date counts on its arrival day only.
create or replace function public.home_dashboard_guests_now(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  prev date := (d - interval '1 month')::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(total_guests), 0) from public.guests
              where arrival_date <= d and coalesce(departure_date, arrival_date) >= d),
    'previous', (select coalesce(sum(total_guests), 0) from public.guests
                 where arrival_date <= prev and coalesce(departure_date, arrival_date) >= prev)
  );
end;
$$;

-- Visits arriving in the next 30 days, vs the 30 days after the same day last month.
create or replace function public.home_dashboard_upcoming_visits(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  prev date := (d - interval '1 month')::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from public.guests
              where arrival_date > d and arrival_date <= d + 30),
    'previous', (select count(*) from public.guests
                 where arrival_date > prev and arrival_date <= prev + 30)
  );
end;
$$;

-- Tasks not yet completed. No history is kept, so no comparison.
create or replace function public.home_dashboard_open_tasks(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from public.tasks where status <> 'completed'),
    'previous', null
  );
end;
$$;

-- Dishes waiting for approval.
create or replace function public.home_dashboard_menu_pending(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from public.menu_items where status = 'draft'),
    'previous', null
  );
end;
$$;

revoke all on function public.home_dashboard_guests_now(text),
                       public.home_dashboard_upcoming_visits(text),
                       public.home_dashboard_open_tasks(text),
                       public.home_dashboard_menu_pending(text)
  from public;
grant execute on function public.home_dashboard_guests_now(text),
                          public.home_dashboard_upcoming_visits(text),
                          public.home_dashboard_open_tasks(text),
                          public.home_dashboard_menu_pending(text)
  to anon, authenticated;
