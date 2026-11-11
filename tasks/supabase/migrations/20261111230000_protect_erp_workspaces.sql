-- A workspace linked to a company ERP (erp_keys) cannot be deleted from the
-- app — that would cut the ERP's Task Hub page off. Unlink it first.
create or replace function public.workspace_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.erp_keys where workspace_id = old.id) then
    raise exception 'This workspace is linked to an ERP (%), so it cannot be deleted here.',
      (select string_agg(name, ', ') from public.erp_keys where workspace_id = old.id);
  end if;
  return old;
end;
$$;
drop trigger if exists workspaces_delete_guard on public.workspaces;
create trigger workspaces_delete_guard before delete on public.workspaces
  for each row execute function public.workspace_delete_guard();
