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

-- ---------------------------------------------------------------------------
-- Cards that mirror SSA's own dashboard (app/(app)/dashboard/page.tsx):
-- Balances UAE / PK, Rent balance UAE / PK, and the bank / cash balances.
-- Like the app: posted entries only, all time, document-currency amounts.
-- ---------------------------------------------------------------------------

create or replace function public.home_dashboard_norm_country(c text)
returns text
language sql immutable set search_path = ''
as $$
  select case upper(trim(c))
    when 'AE' then 'AE' when 'UAE' then 'AE'
    when 'PK' then 'PK' when 'PAK' then 'PK' when 'PAKISTAN' then 'PK'
  end
$$;

-- Debit / credit balances of asset and liability accounts, leaving out cash,
-- bank, tenant and fixed-asset accounts. A line's country is its cost
-- centre's country, else its account's. Each account nets to one side.
create or replace function public.home_dashboard_balances(p_key text, p_country text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_company uuid := (select id from core.companies order by created_at limit 1);
  v_debit numeric;
  v_credit numeric;
begin
  perform public.home_dashboard_check(p_key);

  with recursive fixed_asset_groups as (
    select id from accounting.chart_of_accounts
    where company_id = v_company and deleted_at is null
      and (linked_asset_id is not null or account_name ~* 'fixed[\s_-]*assets?')
    union
    select c.id from accounting.chart_of_accounts c
    join fixed_asset_groups g on c.parent_id = g.id
    where c.company_id = v_company and c.deleted_at is null
  ),
  nets as (
    select jel.account_id, sum(jel.debit_amount - jel.credit_amount) as net
    from accounting.journal_entry_lines jel
    join accounting.journal_entries je on je.id = jel.journal_entry_id
    join accounting.chart_of_accounts coa on coa.id = jel.account_id
    left join accounting.chart_of_accounts parent on parent.id = coa.parent_id
    left join accounting.cost_centers cc on cc.id = jel.cost_center_id
    where je.status = 'posted' and je.company_id = v_company
      and coa.account_type not in ('equity', 'income', 'expense')
      and not coalesce(coa.is_cash, false) and not coalesce(coa.is_bank, false)
      and not coalesce(parent.is_tenant_group, false)
      and not exists (select 1 from assets.assets aa where aa.account_id = coa.id)
      and coa.id not in (select id from fixed_asset_groups)
      and public.home_dashboard_norm_country(
            coalesce(cc.country, case when coa.deleted_at is null then coa.country end)) = p_country
    group by jel.account_id
  )
  select coalesce(sum(net) filter (where net >= 0), 0), coalesce(-sum(net) filter (where net < 0), 0)
  into v_debit, v_credit
  from nets;

  return jsonb_build_object(
    'value', abs(v_debit - v_credit),
    'unit', case p_country when 'AE' then 'AED' else 'Rs' end,
    'suffix', case when abs(v_debit - v_credit) < 0.005 then null when v_debit >= v_credit then 'Dr' else 'Cr' end,
    'rows', jsonb_build_array(
      jsonb_build_object('label', 'Debit', 'value', v_debit),
      jsonb_build_object('label', 'Credit', 'value', v_credit)
    )
  );
end;
$$;

-- Rent: Overdue (due month before this month), Due (this month), Receipts
-- (billed net minus outstanding) and Balance (all outstanding, upcoming too).
-- Slices by each invoice's due date; the app re-slices combined UAE
-- vouchers per lease, which only differs while such a voucher is open.
create or replace function public.home_dashboard_rent_balance(p_key text, p_country text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_company uuid := (select id from core.companies order by created_at limit 1);
  v_month date := date_trunc('month', (now() at time zone 'UTC'))::date;
  r record;
begin
  perform public.home_dashboard_check(p_key);
  select
    coalesce(sum(net_outstanding) filter (where date_trunc('month', due_date) < v_month), 0) as overdue,
    coalesce(sum(net_outstanding) filter (where date_trunc('month', due_date) = v_month), 0) as due,
    coalesce(sum(net_amount), 0) - coalesce(sum(net_outstanding), 0) as receipts,
    coalesce(sum(net_outstanding), 0) as balance
  into r
  from reporting.v_rental_income
  where company_id = v_company and country = p_country;

  return jsonb_build_object(
    'value', r.overdue + r.due,
    'unit', case p_country when 'UAE' then 'AED' else 'Rs' end,
    'rows', jsonb_build_array(
      jsonb_build_object('label', 'Overdue', 'value', r.overdue, 'tone', case when r.overdue > 0 then 'down' end),
      jsonb_build_object('label', 'Due this month', 'value', r.due),
      jsonb_build_object('label', 'Receipts', 'value', r.receipts),
      jsonb_build_object('label', 'Balance', 'value', r.balance)
    ),
    'note', 'Overdue + due'
  );
end;
$$;

-- Bank and cash accounts in one currency, one row per account with a balance.
create or replace function public.home_dashboard_cash_bank(p_key text, p_currency text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_company uuid := (select id from core.companies order by created_at limit 1);
  v_rows jsonb;
  v_total numeric;
begin
  perform public.home_dashboard_check(p_key);
  with balances as (
    select coa.account_code, coa.account_name, coa.is_bank,
           coalesce(sum(jel.debit_amount - jel.credit_amount) filter (where je.status = 'posted'), 0) as net
    from accounting.chart_of_accounts coa
    join core.currencies cur on cur.id = coa.currency_id
    left join accounting.journal_entry_lines jel on jel.account_id = coa.id
    left join accounting.journal_entries je on je.id = jel.journal_entry_id and je.company_id = v_company
    where coa.company_id = v_company and coa.deleted_at is null
      and (coa.is_bank or coa.is_cash) and cur.code = p_currency
    group by coa.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', initcap(account_name), 'value', net)
                            order by is_bank desc, account_code) filter (where abs(net) >= 0.005), '[]'::jsonb),
         coalesce(sum(net), 0)
  into v_rows, v_total
  from balances;

  return jsonb_build_object(
    'value', v_total,
    'unit', case p_currency when 'PKR' then 'Rs' else p_currency end,
    'rows', v_rows
  );
end;
$$;

create or replace function public.home_dashboard_balances_uae(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_balances(p_key, 'AE') $$;
create or replace function public.home_dashboard_balances_pk(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_balances(p_key, 'PK') $$;
create or replace function public.home_dashboard_rent_balance_uae(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_rent_balance(p_key, 'UAE') $$;
create or replace function public.home_dashboard_rent_balance_pk(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_rent_balance(p_key, 'PK') $$;
create or replace function public.home_dashboard_bank_aed(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_cash_bank(p_key, 'AED') $$;
create or replace function public.home_dashboard_bank_pkr(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_cash_bank(p_key, 'PKR') $$;

revoke all on function public.home_dashboard_balances(text, text),
                       public.home_dashboard_rent_balance(text, text),
                       public.home_dashboard_cash_bank(text, text)
  from public, anon, authenticated;
revoke all on function public.home_dashboard_balances_uae(text), public.home_dashboard_balances_pk(text),
                       public.home_dashboard_rent_balance_uae(text), public.home_dashboard_rent_balance_pk(text),
                       public.home_dashboard_bank_aed(text), public.home_dashboard_bank_pkr(text)
  from public;
grant execute on function public.home_dashboard_balances_uae(text), public.home_dashboard_balances_pk(text),
                          public.home_dashboard_rent_balance_uae(text), public.home_dashboard_rent_balance_pk(text),
                          public.home_dashboard_bank_aed(text), public.home_dashboard_bank_pkr(text)
  to anon, authenticated;
