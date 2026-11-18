-- Opening a task's file from the SS Dashboard. The dashboard holds only the
-- anon key and its dashboard key, so it cannot sign a Storage link itself:
-- the "dashboard-file" Edge Function calls this (dashboard key checked here)
-- and signs a short-lived link for the path it returns. Only a file on a task
-- the owner can see.

create or replace function public.dashboard_attachment_path(p_key text, p_attachment uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  a public.task_attachments;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    select * into a from public.task_attachments where id = p_attachment;
    if a.id is null or not public.can_see_task(a.task_id) then raise exception 'File not found.'; end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return jsonb_build_object('path', a.path, 'name', a.name, 'mime', a.mime);
end;
$$;
revoke all on function public.dashboard_attachment_path(text, uuid) from public, anon, authenticated;
grant execute on function public.dashboard_attachment_path(text, uuid) to service_role;
