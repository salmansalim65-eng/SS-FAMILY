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
