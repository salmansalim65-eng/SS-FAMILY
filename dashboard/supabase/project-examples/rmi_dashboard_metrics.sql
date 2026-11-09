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

-- ---------------------------------------------------------------------------
-- Finance cards that mirror RMI's own SS Dashboard (public.ss_dashboard).
-- ss_dashboard checks the signed-in user's rights and campuses, so this runs
-- it for the RMI campus as one of the active admins: the request's JWT claims
-- are set to that admin for the call only and restored straight after. Only
-- the totals below leave the function, and only with the dashboard key.
-- ---------------------------------------------------------------------------

create or replace function public.home_dashboard_rmi_ss()
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin uuid := (select id from public.app_users where is_admin and not is_blocked and user_type = 'staff' order by id limit 1);
  v_campus uuid := (select id from public.campuses where upper(trim(name)) = 'RMI' and is_active limit 1);
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_out jsonb;
begin
  if v_admin is null or v_campus is null then
    raise exception 'RMI admin user or campus not found';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    v_out := public.ss_dashboard(array[v_campus]);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_out;
end;
$$;
revoke all on function public.home_dashboard_rmi_ss() from public, anon, authenticated;

create or replace function public.home_dashboard_rmi_card(p_key text, p_card text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  d jsonb;
  n numeric;
  b numeric;
begin
  perform public.home_dashboard_check(p_key);
  d := public.home_dashboard_rmi_ss();

  case p_card
  when 'bank' then
    n := (d->'bank'->>'month')::numeric;
    return jsonb_build_object('value', (d->'bank'->>'balance')::numeric, 'unit', 'Rs', 'style', 'lakh', 'rows', jsonb_build_array(
      jsonb_build_object('label', 'This month', 'value', n, 'tone', case when n >= 0 then 'up' else 'down' end),
      jsonb_build_object('label', 'Cash in hand', 'value', (d->'bank'->>'cash')::numeric)));
  when 'surplus' then
    n := (d->'pl'->>'income')::numeric - (d->'pl'->>'expense')::numeric;
    return jsonb_build_object('value', n, 'unit', 'Rs', 'style', 'lakh', 'tone', case when n >= 0 then 'up' else 'down' end,
      'rows', jsonb_build_array(
        jsonb_build_object('label', 'Income', 'value', (d->'pl'->>'income')::numeric),
        jsonb_build_object('label', 'Expense', 'value', (d->'pl'->>'expense')::numeric)));
  when 'donations' then
    n := (d->'donations'->>'income')::numeric;
    b := (d->'donations'->>'budget')::numeric;
    return jsonb_build_object('value', n, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(jsonb_build_object('label', 'Budget', 'value', b)),
      'progress', case when b > 0 then round(n / b * 100) end,
      'note', case when b > 0 then round(n / b * 100) || '% of budget' else 'No budget set' end);
  when 'zakat' then
    return jsonb_build_object('value', (d->'zakat'->>'balance')::numeric, 'unit', 'Rs', 'style', 'lakh', 'rows', jsonb_build_array(
      jsonb_build_object('label', 'Received this month', 'value', (d->'zakat'->>'received_month')::numeric),
      jsonb_build_object('label', 'Paid this month', 'value', (d->'zakat'->>'paid_month')::numeric),
      jsonb_build_object('label', 'For RMI this month', 'value', (d->'zakat'->>'rmi_month')::numeric)));
  when 'fees' then
    n := (d->'fees'->>'overdue')::numeric;
    return jsonb_build_object('value', (d->'fees'->>'outstanding')::numeric, 'unit', 'Rs', 'style', 'lakh', 'rows', jsonb_build_array(
      jsonb_build_object('label', 'Overdue', 'value', n, 'tone', case when n > 0 then 'down' end),
      jsonb_build_object('label', 'Collected this month', 'value', (d->'fees'->>'collected_month')::numeric),
      jsonb_build_object('label', 'Collected today', 'value', (d->'fees'->>'collected_today')::numeric)));
  when 'liabilities' then
    return jsonb_build_object(
      'value', (d->'liabilities'->>'suppliers')::numeric + (d->'liabilities'->>'salary')::numeric + (d->'liabilities'->>'other')::numeric,
      'unit', 'Rs', 'style', 'lakh', 'rows', jsonb_build_array(
        jsonb_build_object('label', 'Suppliers', 'value', (d->'liabilities'->>'suppliers')::numeric),
        jsonb_build_object('label', 'Salaries', 'value', (d->'liabilities'->>'salary')::numeric),
        jsonb_build_object('label', 'Other', 'value', (d->'liabilities'->>'other')::numeric)));
  when 'budget' then
    n := (d->'budget_month'->>'actual')::numeric;
    b := (d->'budget_month'->>'budget')::numeric;
    return jsonb_build_object('value', n, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(jsonb_build_object('label', 'Budget', 'value', b)),
      'progress', case when b > 0 then least(round(n / b * 100), 100) end,
      'note', case when b > 0 then round(n / b * 100) || '% of budget spent' else 'No budget set' end);
  when 'cashflow' then
    n := (d->'bank'->>'month')::numeric;
    return jsonb_build_object('value', n, 'unit', 'Rs', 'style', 'lakh', 'tone', case when n >= 0 then 'up' else 'down' end,
      'note', 'Net change in the bank accounts since the 1st');
  else
    raise exception 'unknown card %', p_card;
  end case;
end;
$$;
revoke all on function public.home_dashboard_rmi_card(text, text) from public, anon, authenticated;

create or replace function public.home_dashboard_rmi_bank(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'bank') $$;
create or replace function public.home_dashboard_rmi_surplus(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'surplus') $$;
create or replace function public.home_dashboard_rmi_donations(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'donations') $$;
create or replace function public.home_dashboard_rmi_zakat(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'zakat') $$;
create or replace function public.home_dashboard_rmi_fees(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'fees') $$;
create or replace function public.home_dashboard_rmi_liabilities(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'liabilities') $$;
create or replace function public.home_dashboard_rmi_budget(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'budget') $$;
create or replace function public.home_dashboard_rmi_cashflow(p_key text) returns jsonb
language sql volatile security definer set search_path = public as $$ select public.home_dashboard_rmi_card(p_key, 'cashflow') $$;

revoke all on function public.home_dashboard_rmi_bank(text), public.home_dashboard_rmi_surplus(text),
                       public.home_dashboard_rmi_donations(text), public.home_dashboard_rmi_zakat(text),
                       public.home_dashboard_rmi_fees(text), public.home_dashboard_rmi_liabilities(text),
                       public.home_dashboard_rmi_budget(text), public.home_dashboard_rmi_cashflow(text)
  from public;
grant execute on function public.home_dashboard_rmi_bank(text), public.home_dashboard_rmi_surplus(text),
                          public.home_dashboard_rmi_donations(text), public.home_dashboard_rmi_zakat(text),
                          public.home_dashboard_rmi_fees(text), public.home_dashboard_rmi_liabilities(text),
                          public.home_dashboard_rmi_budget(text), public.home_dashboard_rmi_cashflow(text)
  to anon, authenticated;
