-- Delete and move from the dashboard and the ERP Task Hub pages too.
--  * dashboard_task_delete / dashboard_project_delete: as the owner (key-guarded).
--    A Personal project that mirrors a Google Tasks list is refused — the next
--    sync would bring it back; delete the list in Google Tasks instead.
--  * erp_task_delete: the task's creator, or a workspace owner/admin.
--  * erp_task_move: to another project of the same (key's) workspace that
--    the user can open.

create or replace function public.dashboard_task_delete(p_key text, p_task uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    delete from public.tasks where id = p_task;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_task_delete(text, uuid) from public;
grant execute on function public.dashboard_task_delete(text, uuid) to anon, authenticated;

create or replace function public.dashboard_project_delete(p_key text, p_project uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  if exists (select 1 from public.google_sync_lists where project_id = p_project) then
    raise exception 'This project is a Google Tasks list — delete the list in Google Tasks, and it goes from here on the next sync.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_manage_project(p_project) then raise exception 'Only the workspace owner/admin or the project''s creator can delete it.'; end if;
    delete from public.projects where id = p_project;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_project_delete(text, uuid) from public;
grant execute on function public.dashboard_project_delete(text, uuid) to anon, authenticated;

create or replace function public.erp_task_delete(p_key text, p_email text, p_task uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_task public.tasks;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    perform public.erp_task_project(v_ws, p_task);
    select * into v_task from public.tasks where id = p_task;
    if v_task.created_by is distinct from v_me and not public.is_ws_admin(v_ws) then
      raise exception 'Only the person who made this task, or a workspace owner/admin, can delete it.';
    end if;
    delete from public.tasks where id = p_task;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.erp_task_delete(text, text, uuid) from public;
grant execute on function public.erp_task_delete(text, text, uuid) to anon, authenticated;

create or replace function public.erp_task_move(p_key text, p_email text, p_task uuid, p_project uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_task public.tasks;
  v_bucket uuid;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  if not exists (select 1 from public.projects where id = p_project and workspace_id = v_ws and not archived) then
    raise exception 'Project not found.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    perform public.erp_task_project(v_ws, p_task);
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    select * into v_task from public.tasks where id = p_task;
    if v_task.project_id is distinct from p_project then
      select id into v_bucket from public.buckets where project_id = p_project
       order by (v_task.done and lower(name) = 'done') desc, position limit 1;
      update public.tasks set project_id = p_project, bucket_id = v_bucket where id = p_task;
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.erp_task_move(text, text, uuid, uuid) from public;
grant execute on function public.erp_task_move(text, text, uuid, uuid) to anon, authenticated;
