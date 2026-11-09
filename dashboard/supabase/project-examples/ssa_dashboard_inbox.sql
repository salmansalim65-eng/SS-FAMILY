-- SS Dashboard inbox for SSA: vouchers waiting at an approval step SS can act
-- on, SS's alerts, and Approve / Reject / Send back through SSA's own
-- accounting.fn_approval_action, run as SS's SSA user (the request's JWT
-- claims are set to that user for the call only and restored straight after).
-- A final approval leaves the voucher approved; SSA's app posts it (Post on
-- the voucher's screen). Guarded by the dashboard key (home_dashboard_check).

create or replace function public.home_dashboard_ss_user()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from auth.users where lower(email) = 'ss@ssa-app.internal' limit 1;
$$;
revoke all on function public.home_dashboard_ss_user() from public, anon, authenticated;

-- The same paths as SSA's voucherHref (lib/vouchers/meta.ts).
create or replace function public.home_dashboard_voucher_href(p_type text, p_id uuid)
returns text
language sql immutable set search_path = public
as $$
  select case p_type
    when 'purchase_voucher' then '/purchases/' || p_id
    when 'uae_rent_invoice' then '/rental/uae/invoices/' || p_id
    when 'pk_rent_invoice' then '/rental/pk/invoices/' || p_id
    when 'asset_sales' then '/sales/' || p_id
    when 'rent_statement' then '/rental/rent-statements/' || p_id
    else '/accounting/vouchers/' || p_type || '/' || p_id
  end;
$$;
revoke all on function public.home_dashboard_voucher_href(text, uuid) from public, anon, authenticated;

create or replace function public.home_dashboard_inbox(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_ss uuid := public.home_dashboard_ss_user();
  v_auths jsonb;
  v_alerts jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_ss is null then
    raise exception 'SS user not found in SSA';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', va.id,
           'label', initcap(replace(va.voucher_type, '_', ' ')),
           'detail', 'Step ' || va.current_step || case when nxt.id is null then ' · final approval' else '' end,
           'amount', va.amount,
           'date', va.created_at::date,
           'link', public.home_dashboard_voucher_href(va.voucher_type, va.voucher_id),
           'can_act', true,
           'final', nxt.id is null
         ) order by va.created_at), '[]'::jsonb)
    into v_auths
    from accounting.voucher_approvals va
    join accounting.approval_workflow_steps st on st.workflow_id = va.workflow_id and st.step_order = va.current_step
    left join lateral (
      select s2.id from accounting.approval_workflow_steps s2
       where s2.workflow_id = va.workflow_id and s2.step_order > va.current_step
         and (s2.min_amount is null or va.amount >= s2.min_amount)
         and (s2.max_amount is null or va.amount <= s2.max_amount)
       order by s2.step_order limit 1
    ) nxt on true
   where va.status = 'pending'
     and exists (select 1 from core.user_roles ur
                  where ur.user_id = v_ss and ur.company_id = va.company_id and ur.role_id = st.approver_role_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'body', x.body, 'link', x.url, 'at', x.created_at
         ) order by x.created_at desc), '[]'::jsonb)
    into v_alerts
    from (select * from core.alerts where user_id = v_ss and read_at is null order by created_at desc limit 50) x;

  return jsonb_build_object('authorizations', v_auths, 'alerts', v_alerts);
end;
$$;
revoke all on function public.home_dashboard_inbox(text) from public;
grant execute on function public.home_dashboard_inbox(text) to anon, authenticated;

-- Approve / reject / send back one voucher approval as SS; returns {status}.
create or replace function public.home_dashboard_act(p_key text, p_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_ss uuid := public.home_dashboard_ss_user();
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_row accounting.voucher_approvals;
begin
  perform public.home_dashboard_check(p_key);
  if v_ss is null then
    raise exception 'SS user not found in SSA';
  end if;
  if p_action not in ('approve', 'reject', 'send_back') then
    raise exception 'Unknown action.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ss, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_ss::text, true);
  begin
    v_row := accounting.fn_approval_action(p_id, p_action, left(nullif(trim(p_note), ''), 500));
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return jsonb_build_object('status', v_row.status,
    'link', public.home_dashboard_voucher_href(v_row.voucher_type, v_row.voucher_id));
end;
$$;
revoke all on function public.home_dashboard_act(text, uuid, text, text) from public;
grant execute on function public.home_dashboard_act(text, uuid, text, text) to anon, authenticated;

-- Marks one of SS's alerts read (all of them when p_id is null).
create or replace function public.home_dashboard_alert_read(p_key text, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  perform public.home_dashboard_check(p_key);
  update core.alerts set read_at = now()
   where user_id = public.home_dashboard_ss_user() and read_at is null and (p_id is null or id = p_id);
end;
$$;
revoke all on function public.home_dashboard_alert_read(text, uuid) from public;
grant execute on function public.home_dashboard_alert_read(text, uuid) to anon, authenticated;
