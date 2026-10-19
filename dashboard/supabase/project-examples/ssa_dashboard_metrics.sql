-- Run in the SSA Supabase project (not the dashboard project).
--
-- Numbers for the SSA cards on the personal dashboard. Every function
-- demands a shared secret (p_key) whose SHA-256 hash lives in a table the API
-- cannot read, because SSA's anon key ships in its web app. Put the secret
-- itself in the dashboard's SSA_DASHBOARD_KEY env variable, and store its hash here:
--   insert into public.home_dashboard_key (key_hash)
--   values (encode(sha256(convert_to('<the secret>', 'UTF8')), 'hex'))
--   on conflict (id) do update set key_hash = excluded.key_hash;
--
-- SSA's data lives in the rental, assets and core schemas; these functions
-- sit in public so the API can call them. Leases and invoices are in AED or
-- PKR, so outstanding rent is reported per currency, never added together.
-- "Today" is Asia/Karachi.

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
as $$ select (now() at time zone 'Asia/Karachi')::date $$;

-- Rental properties on the books.
create or replace function public.home_dashboard_properties(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from assets.assets where is_rental and deleted_at is null),
    'previous', null
  );
end;
$$;

-- Leases running today (UAE and Pakistan), vs at the start of this month.
create or replace function public.home_dashboard_active_leases(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  m date := date_trunc('month', d)::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from rental.uae_leases
              where deleted_at is null and status = 'active' and lease_start <= d and (lease_end is null or lease_end >= d))
           + (select count(*) from rental.pk_leases
              where deleted_at is null and status = 'active' and lease_start <= d and (lease_end is null or lease_end >= d)),
    'previous', (select count(*) from rental.uae_leases
                 where deleted_at is null and status = 'active' and lease_start <= m and (lease_end is null or lease_end >= m))
              + (select count(*) from rental.pk_leases
                 where deleted_at is null and status = 'active' and lease_start <= m and (lease_end is null or lease_end >= m))
  );
end;
$$;

-- Unpaid rent invoiced in one currency (UAE and Pakistan invoices together).
create or replace function public.home_dashboard_rent_outstanding(p_key text, p_currency text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(i.outstanding_balance), 0) from rental.uae_rent_invoices i
              join core.currencies c on c.id = i.currency_id where c.code = p_currency)
           + (select coalesce(sum(i.outstanding_amount), 0) from rental.pk_rent_invoices i
              join core.currencies c on c.id = i.currency_id where c.code = p_currency),
    'previous', null
  );
end;
$$;

create or replace function public.home_dashboard_rent_outstanding_aed(p_key text)
returns jsonb
language sql stable security definer set search_path = public
as $$ select public.home_dashboard_rent_outstanding(p_key, 'AED') $$;

create or replace function public.home_dashboard_rent_outstanding_pkr(p_key text)
returns jsonb
language sql stable security definer set search_path = public
as $$ select public.home_dashboard_rent_outstanding(p_key, 'PKR') $$;

revoke all on function public.home_dashboard_rent_outstanding(text, text) from public, anon, authenticated;
revoke all on function public.home_dashboard_properties(text),
                       public.home_dashboard_active_leases(text),
                       public.home_dashboard_rent_outstanding_aed(text),
                       public.home_dashboard_rent_outstanding_pkr(text)
  from public;
grant execute on function public.home_dashboard_properties(text),
                          public.home_dashboard_active_leases(text),
                          public.home_dashboard_rent_outstanding_aed(text),
                          public.home_dashboard_rent_outstanding_pkr(text)
  to anon, authenticated;
