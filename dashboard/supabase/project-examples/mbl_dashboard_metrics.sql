-- Run in the MBL Supabase project (not the dashboard project).
--
-- Numbers for the MBL cards on the personal dashboard. Every function
-- demands a shared secret (p_key) whose SHA-256 hash lives in a table the API
-- cannot read, because MBL's anon key ships in its web app. Put the secret
-- itself in the dashboard's MBL_DASHBOARD_KEY env variable, and store its hash here:
--   insert into public.home_dashboard_key (key_hash)
--   values (encode(sha256(convert_to('<the secret>', 'UTF8')), 'hex'))
--   on conflict (id) do update set key_hash = excluded.key_hash;
--
-- Amounts are in the base currency (Pak Rs) from gl_entries. "Today" is Asia/Karachi.

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

-- Sales posted this month (credits less debits on sales accounts), vs last month.
create or replace function public.home_dashboard_sales_month(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m date := date_trunc('month', public.home_dashboard_today())::date;
  pm date := (m - interval '1 month')::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(g.base_credit - g.base_debit), 0) from gl_entries g
              join accounts a on a.id = g.account_id
              where a.account_type = 'sales' and g.entry_date >= m and g.entry_date < (m + interval '1 month')),
    'previous', (select coalesce(sum(g.base_credit - g.base_debit), 0) from gl_entries g
                 join accounts a on a.id = g.account_id
                 where a.account_type = 'sales' and g.entry_date >= pm and g.entry_date < m)
  );
end;
$$;

-- What customers owe (positive balances only), vs at the start of this month.
create or replace function public.home_dashboard_receivables(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m date := date_trunc('month', public.home_dashboard_today())::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(b), 0) from (
                select sum(g.base_debit - g.base_credit) b from gl_entries g
                join accounts a on a.id = g.account_id
                where a.account_type = 'customer_vendor' and a.party_kind in ('customer', 'both')
                group by g.account_id) x where b > 0),
    'previous', (select coalesce(sum(b), 0) from (
                   select sum(g.base_debit - g.base_credit) b from gl_entries g
                   join accounts a on a.id = g.account_id
                   where a.account_type = 'customer_vendor' and a.party_kind in ('customer', 'both')
                     and g.entry_date < m
                   group by g.account_id) x where b > 0)
  );
end;
$$;

-- Cash and bank balance, vs at the start of this month.
create or replace function public.home_dashboard_cash_bank(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m date := date_trunc('month', public.home_dashboard_today())::date;
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select coalesce(sum(g.base_debit - g.base_credit), 0) from gl_entries g
              join accounts a on a.id = g.account_id
              where a.account_type in ('bank', 'cash_petty_cash')),
    'previous', (select coalesce(sum(g.base_debit - g.base_credit), 0) from gl_entries g
                 join accounts a on a.id = g.account_id
                 where a.account_type in ('bank', 'cash_petty_cash') and g.entry_date < m)
  );
end;
$$;

-- Documents waiting for authorization.
create or replace function public.home_dashboard_pending_docs(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  return jsonb_build_object(
    'value', (select count(*) from documents where status = 'pending'),
    'previous', null
  );
end;
$$;

revoke all on function public.home_dashboard_sales_month(text),
                       public.home_dashboard_receivables(text),
                       public.home_dashboard_cash_bank(text),
                       public.home_dashboard_pending_docs(text)
  from public;
grant execute on function public.home_dashboard_sales_month(text),
                          public.home_dashboard_receivables(text),
                          public.home_dashboard_cash_bank(text),
                          public.home_dashboard_pending_docs(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cards that mirror MBL's own dashboard: P&L, sales, orders in hand, expenses,
-- customer balances, current liabilities and cash & bank, all read from
-- MBL's dashboard_figures_unchecked() (posted ledger, base currency).
-- ---------------------------------------------------------------------------

create or replace function public.home_dashboard_mbl_card(p_key text, p_card text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  f jsonb;
  r jsonb;
  amt numeric;
begin
  perform public.home_dashboard_check(p_key);
  select jsonb_object_agg(tile || '/' || bucket, amount) into f
  from public.dashboard_figures_unchecked(current_date) where tile <> 'stock';

  case p_card
  when 'pnl' then
    return jsonb_build_object('value', (f->>'profit/ytd')::numeric, 'unit', 'Rs', 'style', 'lakh',
      'tone', case when (f->>'profit/ytd')::numeric >= 0 then 'up' else 'down' end,
      'rows', jsonb_build_array(
        jsonb_build_object('label', 'This month', 'value', (f->>'profit/this_month')::numeric,
                           'tone', case when (f->>'profit/this_month')::numeric >= 0 then 'up' else 'down' end),
        jsonb_build_object('label', 'Last month', 'value', (f->>'profit/last_month')::numeric,
                           'tone', case when (f->>'profit/last_month')::numeric >= 0 then 'up' else 'down' end)),
      'note', 'Business group, year to date');
  when 'sales' then
    return jsonb_build_object(
      'value', (f->>'sales/ytd')::numeric + (f->>'sales/local_ytd')::numeric, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(
        jsonb_build_object('label', 'This month', 'value', (f->>'sales/this_month')::numeric + (f->>'sales/local_this_month')::numeric),
        jsonb_build_object('label', 'Last month', 'value', (f->>'sales/last_month')::numeric + (f->>'sales/local_last_month')::numeric),
        jsonb_build_object('label', 'Local (YTD)', 'value', (f->>'sales/local_ytd')::numeric)),
      'note', 'Year to date');
  when 'orders' then
    return jsonb_build_object('value', (f->>'orders/balance')::numeric, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(jsonb_build_object('label', 'Orders', 'plain', true, 'value',
        (select count(distinct pbl.base_document_id) from public.pending_base_lines pbl
          where pbl.workflow_id in (select public.in_hand_workflows())))),
      'note', 'Not yet invoiced');
  when 'expenses' then
    return jsonb_build_object('value', (f->>'expenses/ytd')::numeric, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(
        jsonb_build_object('label', 'This month', 'value', (f->>'expenses/this_month')::numeric),
        jsonb_build_object('label', 'Last month', 'value', (f->>'expenses/last_month')::numeric)),
      'note', 'Year to date');
  when 'customers' then
    return jsonb_build_object('value', (f->>'customers/debit')::numeric, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(
        jsonb_build_object('label', 'Advances', 'value', (f->>'customers/credit')::numeric),
        jsonb_build_object('label', 'Net', 'value', (f->>'customers/net')::numeric)),
      'note', 'Receivable');
  when 'liabilities' then
    return jsonb_build_object('value', (f->>'suppliers/credit')::numeric, 'unit', 'Rs', 'style', 'lakh',
      'rows', jsonb_build_array(
        jsonb_build_object('label', 'Debit balances', 'value', (f->>'suppliers/debit')::numeric),
        jsonb_build_object('label', 'Net', 'value', abs((f->>'suppliers/net')::numeric),
                           'suffix', case when (f->>'suppliers/net')::numeric < 0 then 'Cr' else 'Dr' end)));
  when 'cashbank' then
    -- Bank and cash accounts plus the ones ticked "show on dashboard", like
    -- MBL's Cash & Bank card; banks under "BANK (NOT USE)" are left out.
    with bal as (
      select coalesce(p.name, 'Other') as grp, p.sort_order, sum(g.base_debit - g.base_credit) as net
      from public.accounts a
      join public.gl_posted g on g.account_id = a.id and g.entry_date <= current_date
      left join public.accounts p on p.id = a.parent_id
      where (a.account_type in ('bank', 'cash_petty_cash') or a.show_on_dashboard)
        and not (a.account_type = 'bank' and coalesce(p.name, '') ilike '%not use%')
      group by coalesce(p.name, 'Other'), p.sort_order
      having abs(sum(g.base_debit - g.base_credit)) >= 0.5
    )
    select coalesce(jsonb_agg(jsonb_build_object('label', initcap(grp), 'value', net) order by sort_order, grp), '[]'),
           coalesce(sum(net), 0)
    into r, amt from bal;
    return jsonb_build_object('value', amt, 'unit', 'Rs', 'style', 'lakh', 'rows', r);
  else
    raise exception 'unknown card %', p_card;
  end case;
end;
$$;
revoke all on function public.home_dashboard_mbl_card(text, text) from public, anon, authenticated;

create or replace function public.home_dashboard_mbl_pnl(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'pnl') $$;
create or replace function public.home_dashboard_mbl_sales(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'sales') $$;
create or replace function public.home_dashboard_mbl_orders(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'orders') $$;
create or replace function public.home_dashboard_mbl_expenses(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'expenses') $$;
create or replace function public.home_dashboard_mbl_customers(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'customers') $$;
create or replace function public.home_dashboard_mbl_liabilities(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'liabilities') $$;
create or replace function public.home_dashboard_mbl_cashbank(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$ select public.home_dashboard_mbl_card(p_key, 'cashbank') $$;

revoke all on function public.home_dashboard_mbl_pnl(text), public.home_dashboard_mbl_sales(text),
                       public.home_dashboard_mbl_orders(text), public.home_dashboard_mbl_expenses(text),
                       public.home_dashboard_mbl_customers(text), public.home_dashboard_mbl_liabilities(text),
                       public.home_dashboard_mbl_cashbank(text)
  from public;
grant execute on function public.home_dashboard_mbl_pnl(text), public.home_dashboard_mbl_sales(text),
                          public.home_dashboard_mbl_orders(text), public.home_dashboard_mbl_expenses(text),
                          public.home_dashboard_mbl_customers(text), public.home_dashboard_mbl_liabilities(text),
                          public.home_dashboard_mbl_cashbank(text)
  to anon, authenticated;
