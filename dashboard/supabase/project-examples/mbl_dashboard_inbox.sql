-- SS Dashboard inbox for MBL: SS's own authorization queue and alerts.
-- Read-only for authorizations: MBL requires its own signed-in session (and
-- MFA where set) to authorize, so the dashboard only links to /authorizations.
-- Each call runs MBL's own functions as SS's MBL user: the request's JWT
-- claims are set to that user for the call only and restored straight after.
-- Guarded by the dashboard key (home_dashboard_check).

create or replace function public.home_dashboard_ss_user()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from auth.users where lower(email) = 'ss@mbl-erp.local' limit 1;
$$;
revoke all on function public.home_dashboard_ss_user() from public, anon, authenticated;

create or replace function public.home_dashboard_inbox(p_key text)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_ss uuid := public.home_dashboard_ss_user();
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_auths jsonb;
  v_alerts jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_ss is null then
    raise exception 'SS user not found in MBL';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ss, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_ss::text, true);
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.document_id,
             'label', coalesce(a.short_prefix || ':', '') || a.doc_no,
             'detail', concat_ws(' · ', a.doc_type, nullif(trim(a.narration), ''), 'Level ' || a.level_no),
             'amount', a.total,
             'date', a.doc_date,
             'link', '/authorizations',
             'can_act', false
           ) order by a.doc_date, a.doc_no), '[]'::jsonb)
      into v_auths
      from public.my_pending_authorizations() a;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.message, 'body', null, 'link', '/authorizations', 'at', x.created_at
         ) order by x.created_at desc), '[]'::jsonb)
    into v_alerts
    from (select * from public.auth_alerts where user_id = v_ss and not is_read order by created_at desc limit 50) x;

  return jsonb_build_object('authorizations', v_auths, 'alerts', v_alerts);
end;
$$;
revoke all on function public.home_dashboard_inbox(text) from public;
grant execute on function public.home_dashboard_inbox(text) to anon, authenticated;

-- Marks one of SS's alerts read (all of them when p_id is null).
create or replace function public.home_dashboard_alert_read(p_key text, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  update public.auth_alerts set is_read = true
   where user_id = public.home_dashboard_ss_user() and not is_read and (p_id is null or id = p_id);
end;
$$;
revoke all on function public.home_dashboard_alert_read(text, uuid) from public;
grant execute on function public.home_dashboard_alert_read(text, uuid) to anon, authenticated;
