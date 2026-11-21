-- Task files from the ERPs (RMI's task panel): see, open, add and remove a
-- task's attachments. The ERP holds only the anon key and its ERP key, so the
-- "erp-file" Edge Function (service role) signs Storage links; these check
-- the ERP key, the user (by email) and that the user can see the task, the
-- same as erp_task_detail. Service role only.

create or replace function public.erp_file_task(p_key text, p_email text, p_task uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
-- The signed-in ERP user, after checking the key and that they can see the task.
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    perform public.erp_task_project(v_ws, p_task);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_me;
end;
$$;

create or replace function public.erp_file_open(p_key text, p_email text, p_attachment uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare a public.task_attachments;
begin
  perform public.erp_workspace(p_key);
  select * into a from public.task_attachments where id = p_attachment;
  if a.id is null then raise exception 'File not found.'; end if;
  perform public.erp_file_task(p_key, p_email, a.task_id);
  return jsonb_build_object('path', a.path, 'name', a.name);
end;
$$;

create or replace function public.erp_file_prepare(p_key text, p_email text, p_task uuid, p_name text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_name text := regexp_replace(left(trim(coalesce(p_name, '')), 120), '[^A-Za-z0-9._ -]+', '_', 'g');
begin
  perform public.erp_file_task(p_key, p_email, p_task);
  if v_name = '' then v_name := 'file'; end if;
  return p_task::text || '/' || replace(gen_random_uuid()::text, '-', '') || '-' || v_name;
end;
$$;

create or replace function public.erp_file_register(p_key text, p_email text, p_task uuid, p_name text, p_path text, p_size bigint, p_mime text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.erp_file_task(p_key, p_email, p_task);
  v_id uuid;
begin
  if p_path is null or left(p_path, 37) <> p_task::text || '/' or position('..' in p_path) > 0 then
    raise exception 'That file does not belong to this task.';
  end if;
  insert into public.task_attachments (task_id, name, path, size, mime, uploaded_by)
  values (p_task, left(coalesce(nullif(trim(p_name), ''), 'file'), 255), p_path, p_size, nullif(left(coalesce(p_mime, ''), 120), ''), v_me)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.erp_file_remove(p_key text, p_email text, p_attachment uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
-- Whoever added the file, or the project's owners, as in Task Hub.
declare
  a public.task_attachments;
  v_me uuid;
  v_project uuid;
begin
  perform public.erp_workspace(p_key);
  select * into a from public.task_attachments where id = p_attachment;
  if a.id is null then raise exception 'File not found.'; end if;
  v_me := public.erp_file_task(p_key, p_email, a.task_id);
  select project_id into v_project from public.tasks where id = a.task_id;
  if a.uploaded_by <> v_me and not public.is_project_owner(v_project, v_me) then
    raise exception 'Only whoever added this file, or the project owner, can remove it.';
  end if;
  delete from public.task_attachments where id = a.id;
  return a.path;
end;
$$;

revoke all on function public.erp_file_task(text, text, uuid) from public, anon, authenticated;
revoke all on function public.erp_file_open(text, text, uuid) from public, anon, authenticated;
revoke all on function public.erp_file_prepare(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.erp_file_register(text, text, uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.erp_file_remove(text, text, uuid) from public, anon, authenticated;
grant execute on function public.erp_file_open(text, text, uuid) to service_role;
grant execute on function public.erp_file_prepare(text, text, uuid, text) to service_role;
grant execute on function public.erp_file_register(text, text, uuid, text, text, bigint, text) to service_role;
grant execute on function public.erp_file_remove(text, text, uuid) to service_role;
