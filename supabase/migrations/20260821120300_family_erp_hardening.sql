-- ============================================================================
-- SS-FAMILY :: hardening
--
-- PostgREST exposes every function in `public` as an RPC endpoint, and
-- PostgreSQL grants EXECUTE to PUBLIC by default. That combination meant
-- `fn_notify` could be called straight from the browser by any user - even a
-- signed-out one - to push arbitrary notifications to anybody. Trigger and
-- guard functions were exposed the same way.
--
-- Locking the default down and re-granting only what the client genuinely
-- calls. Trigger functions do not need a runtime EXECUTE grant: PostgreSQL
-- checks that privilege when the trigger is created, not when it fires.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Deny by default
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Re-grant only the surface the app uses.
--
-- The role helpers stay granted to `authenticated` because RLS policies call
-- them while running as the caller, so the caller needs EXECUTE.
-- ---------------------------------------------------------------------------
grant execute on function
  public.app_role(),
  public.is_head(),
  public.is_family(),
  public.is_driver()
  to authenticated;

grant execute on function
  public.dashboard_stats(),
  public.mark_all_notifications_read(),
  public.find_similar_shopping_items(text, real),
  public.set_shopping_status(uuid[], public.shop_status)
  to authenticated;

-- fn_notify fans out to arbitrary recipients, so it is server-side only: our
-- triggers call it internally, and the reminders edge function calls it with
-- the service role key.
grant execute on function
  public.fn_notify(uuid[], text, text, text, text, uuid, text),
  public.fn_users_by_role(public.user_role[])
  to service_role;

-- ---------------------------------------------------------------------------
-- Pin search_path on the remaining SECURITY INVOKER trigger functions so they
-- cannot be redirected by a caller-controlled search_path.
-- ---------------------------------------------------------------------------
alter function public.touch_updated_at()   set search_path = public;
alter function public.trg_menu_stamp()     set search_path = public;
alter function public.trg_task_stamp()     set search_path = public;
alter function public.trg_shopping_stamp() set search_path = public;

-- ---------------------------------------------------------------------------
-- Left over from an earlier scaffold and not used by this app. Left in place,
-- but no longer reachable from the browser.
-- ---------------------------------------------------------------------------
do $$ begin
  execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
exception when undefined_function then null; end $$;
