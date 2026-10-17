-- Run this in the RMI Supabase project (not the dashboard project).
-- Backs the "Low-stock items" card (query_type = rpc). PostgREST can't
-- compare two columns in a filter, so the comparison lives in a function.
-- Adjust the table/column names to the real RMI inventory schema.

create or replace function public.dashboard_low_stock_count()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'value',    (select count(*) from inventory_items where quantity <= reorder_level),
    'previous', null   -- return last month's figure here if you snapshot it
  );
$$;

revoke all on function public.dashboard_low_stock_count() from public;
-- Grant to whichever key the dashboard uses for RMI:
-- With the anon key, anyone holding it can call this; it only returns a count.
grant execute on function public.dashboard_low_stock_count() to anon;          -- RMI_SUPABASE_ANON_KEY
-- grant execute on function public.dashboard_low_stock_count() to service_role; -- RMI_SUPABASE_SERVICE_ROLE_KEY
