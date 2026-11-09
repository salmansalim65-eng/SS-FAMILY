-- SS Dashboard inbox for RMI: SS's authorization queue and notifications, and
-- Approve / Reject / Suspend through RMI's own auth_act, run as SS's RMI user
-- (the request's JWT claims are set to that user for the call only and
-- restored straight after). Forms whose approval needs RMI's app afterwards
-- (admissions: photo, WhatsApp, parents' login, class) are link-only.
-- Guarded by the dashboard key (home_dashboard_check).

create or replace function public.home_dashboard_ss_user()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from auth.users where lower(email) = 'salmansalim65@gmail.com' limit 1;
$$;
revoke all on function public.home_dashboard_ss_user() from public, anon, authenticated;

-- Object keys that must be authorized in RMI itself.
create or replace function public.home_dashboard_link_only(p_object text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_object in ('voucher.hifz_interview', 'voucher.other_admission', 'voucher.academy_interview');
$$;
revoke all on function public.home_dashboard_link_only(text) from public, anon, authenticated;

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
    raise exception 'SS user not found in RMI';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ss, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_ss::text, true);
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.voucher_id,
             'label', a.doc_label,
             'detail', concat_ws(' · ', a.campus, nullif(a.created_by, ''), 'Level ' || a.level_no),
             'amount', a.total,
             'date', a.doc_date,
             'link', '/vouchers/open/' || a.voucher_id,
             'can_act', not public.home_dashboard_link_only(a.object_key)
           ) order by a.doc_date, a.doc_label), '[]'::jsonb)
      into v_auths
      from private.my_authorizations() a;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'body', x.body,
           'link', coalesce(x.link, case when x.voucher_id is not null then '/vouchers/open/' || x.voucher_id end),
           'at', x.created_at
         ) order by x.created_at desc), '[]'::jsonb)
    into v_alerts
    from (select * from public.notifications where user_id = v_ss and read_at is null order by created_at desc limit 50) x;

  return jsonb_build_object('authorizations', v_auths, 'alerts', v_alerts);
end;
$$;
revoke all on function public.home_dashboard_inbox(text) from public;
grant execute on function public.home_dashboard_inbox(text) to anon, authenticated;

-- Approve / reject / suspend one voucher as SS; returns {status}.
create or replace function public.home_dashboard_act(p_key text, p_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_ss uuid := public.home_dashboard_ss_user();
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_object text;
  v_out jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_ss is null then
    raise exception 'SS user not found in RMI';
  end if;
  if p_action not in ('approve', 'reject', 'suspend') then
    raise exception 'Unknown action.';
  end if;
  select object_key into v_object from public.vouchers where id = p_id;
  if v_object is null then
    raise exception 'Voucher not found.';
  end if;
  if public.home_dashboard_link_only(v_object) then
    raise exception 'Open this form in RMI to authorize it.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ss, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_ss::text, true);
  begin
    v_out := private.auth_act(p_id, p_action, left(nullif(trim(p_note), ''), 500));
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
revoke all on function public.home_dashboard_act(text, uuid, text, text) from public;
grant execute on function public.home_dashboard_act(text, uuid, text, text) to anon, authenticated;

-- Marks one of SS's notifications read (all of them when p_id is null).
create or replace function public.home_dashboard_alert_read(p_key text, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  update public.notifications set read_at = now()
   where user_id = public.home_dashboard_ss_user() and read_at is null and (p_id is null or id = p_id);
end;
$$;
revoke all on function public.home_dashboard_alert_read(text, uuid) from public;
grant execute on function public.home_dashboard_alert_read(text, uuid) to anon, authenticated;
