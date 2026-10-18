-- Run in the RMI Supabase project (not the dashboard project).
--
-- Numbers for the RMI cards on the personal dashboard. RMI's tables all sit
-- behind RLS and its anon key ships in the RMI web app, so every function
-- also demands a shared secret (p_key) whose SHA-256 hash lives in a table
-- the API cannot read. Put the secret itself in the dashboard's
-- RMI_DASHBOARD_KEY env variable, and store its hash here:
--   insert into public.home_dashboard_key (key_hash)
--   values (encode(sha256(convert_to('<the secret>', 'UTF8')), 'hex'))
--   on conflict (id) do update set key_hash = excluded.key_hash;
--
-- "Today" is Asia/Karachi. Students are the accounts in student_profiles.

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

-- Students enrolled today, vs at the start of this month.
create or replace function public.home_dashboard_students(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  m date := date_trunc('month', d)::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from student_profiles
              where coalesce(joining_date, d) <= d and (leaving_date is null or leaving_date > d)),
    'previous', (select count(*) from student_profiles
                 where coalesce(joining_date, m - 1) < m and (leaving_date is null or leaving_date >= m))
  );
end;
$$;

-- Fee receipts posted to student accounts today, vs the same day last month.
create or replace function public.home_dashboard_fee_today(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.home_dashboard_today();
  prev date := (d - interval '1 month')::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(l.credit), 0) from ledger_entries l
              join student_profiles s on s.account_id = l.account_id
              where l.object_key = 'voucher.fee_receipt' and l.entry_date = d),
    'previous', (select coalesce(sum(l.credit), 0) from ledger_entries l
                 join student_profiles s on s.account_id = l.account_id
                 where l.object_key = 'voucher.fee_receipt' and l.entry_date = prev)
  );
end;
$$;

-- What students owe now (positive balances only), vs at the start of this month.
create or replace function public.home_dashboard_pending_dues(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m date := date_trunc('month', public.home_dashboard_today())::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(b), 0) from (
                select sum(l.debit - l.credit) b from ledger_entries l
                join student_profiles s on s.account_id = l.account_id
                group by l.account_id) x where b > 0),
    'previous', (select coalesce(sum(b), 0) from (
                   select sum(l.debit - l.credit) b from ledger_entries l
                   join student_profiles s on s.account_id = l.account_id
                   where l.entry_date < m
                   group by l.account_id) x where b > 0)
  );
end;
$$;

-- Stocked products (not services or groups) with nothing left on hand.
-- products has no reorder level, so "low" means "out".
create or replace function public.home_dashboard_out_of_stock(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from products p
              where not p.is_group and coalesce(p.product_type, '') <> 'service'
                and coalesce((select sum(e.qty_in - e.qty_out) from stock_entries e where e.product_id = p.id), 0) <= 0),
    'previous', null
  );
end;
$$;

-- Net payroll for this month, vs last month.
create or replace function public.home_dashboard_payroll(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m date := date_trunc('month', public.home_dashboard_today())::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(net), 0) from payroll_results where date_trunc('month', month) = m),
    'previous', (select coalesce(sum(net), 0) from payroll_results
                 where date_trunc('month', month) = (m - interval '1 month'))
  );
end;
$$;

revoke all on function public.home_dashboard_students(text),
                       public.home_dashboard_fee_today(text),
                       public.home_dashboard_pending_dues(text),
                       public.home_dashboard_out_of_stock(text),
                       public.home_dashboard_payroll(text)
  from public;
grant execute on function public.home_dashboard_students(text),
                          public.home_dashboard_fee_today(text),
                          public.home_dashboard_pending_dues(text),
                          public.home_dashboard_out_of_stock(text),
                          public.home_dashboard_payroll(text)
  to anon, authenticated;
