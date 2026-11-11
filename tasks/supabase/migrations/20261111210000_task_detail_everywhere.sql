-- The task detail panel (title, project, column, priority, start/due,
-- people, notes, checklist, comments) inside the dashboard and the ERPs, so
-- clicking a task opens it right there instead of in the Task Hub app.
--  * task_hub_detail / task_hub_apply do the work as the CURRENT impersonated
--    user (callers set request.jwt.claims first) and check access themselves
--    (they are security definer, so RLS does not apply inside them).
--  * dashboard_task_detail / dashboard_task_apply: as the owner, key-guarded.
--  * erp_task_detail / erp_task_apply: as the ERP user, inside the key's
--    workspace only.
-- Move, assign and delete keep their existing functions.

create or replace function public.task_hub_detail(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  t public.tasks;
  v_ws uuid;
begin
  if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
  select * into t from public.tasks where id = p_task;
  select workspace_id into v_ws from public.projects where id = t.project_id;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'notes', coalesce(t.notes, ''), 'start', t.start_date, 'due', t.due_date,
    'priority', t.priority, 'done', t.done, 'project_id', t.project_id, 'bucket_id', t.bucket_id,
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.position)
                           from public.buckets b where b.project_id = t.project_id), '[]'::jsonb),
    'people', public.erp_project_people(t.project_id),
    'assignee_ids', coalesce((select jsonb_agg(a.user_id) from public.task_assignees a where a.task_id = t.id), '[]'::jsonb),
    'checklist', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'done', c.done) order by c.position, c.id)
                             from public.checklist_items c where c.task_id = t.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'created_at', m.created_at, 'mine', m.user_id = v_me,
                                                              'name', coalesce(nullif(pr.full_name, ''), pr.email, 'Someone')) order by m.created_at)
                            from public.comments m left join public.profiles pr on pr.id = m.user_id where m.task_id = t.id), '[]'::jsonb),
    'can_delete', t.created_by = v_me or public.is_ws_admin(v_ws)
  );
end;
$$;
revoke all on function public.task_hub_detail(uuid) from public, anon, authenticated;

-- One change to a task. p_op.op is one of:
--   set           {title?, notes?, start?, due?, priority?, bucket?, done?}
--   check_add     {title}
--   check_toggle  {id}
--   check_delete  {id}
--   comment       {body}
create or replace function public.task_hub_apply(p_task uuid, p_op jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_op text := p_op->>'op';
  t public.tasks;
  v_bucket uuid;
  v_text text;
begin
  if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
  select * into t from public.tasks where id = p_task;

  if v_op = 'set' then
    if p_op ? 'title' then
      v_text := left(trim(coalesce(p_op->>'title', '')), 300);
      if v_text = '' then raise exception 'A task needs a title.'; end if;
      update public.tasks set title = v_text where id = p_task;
    end if;
    if p_op ? 'notes' then update public.tasks set notes = left(coalesce(p_op->>'notes', ''), 20000) where id = p_task; end if;
    if p_op ? 'start' then update public.tasks set start_date = nullif(p_op->>'start', '')::date where id = p_task; end if;
    if p_op ? 'due' then update public.tasks set due_date = nullif(p_op->>'due', '')::date where id = p_task; end if;
    if p_op ? 'priority' then update public.tasks set priority = nullif(p_op->>'priority', '')::public.task_priority where id = p_task; end if;
    if p_op ? 'bucket' then
      select id into v_bucket from public.buckets where id = (p_op->>'bucket')::uuid and project_id = t.project_id;
      if v_bucket is null then raise exception 'That column is not in this project.'; end if;
      update public.tasks set bucket_id = v_bucket where id = p_task;
      if exists (select 1 from public.buckets where id = v_bucket and lower(name) = 'done') then
        perform public.sync_set_done(p_task, true);
      elsif t.done then
        update public.tasks set done = false where id = p_task;
      end if;
    end if;
    if p_op ? 'done' then perform public.sync_set_done(p_task, (p_op->>'done')::boolean); end if;

  elsif v_op = 'check_add' then
    v_text := left(trim(coalesce(p_op->>'title', '')), 300);
    if v_text = '' then raise exception 'Write the checklist item first.'; end if;
    insert into public.checklist_items (task_id, title, position)
    values (p_task, v_text, coalesce((select max(position) from public.checklist_items where task_id = p_task), 0) + 1);

  elsif v_op = 'check_toggle' then
    update public.checklist_items set done = not done where id = (p_op->>'id')::uuid and task_id = p_task;
    if not found then raise exception 'Checklist item not found.'; end if;

  elsif v_op = 'check_delete' then
    delete from public.checklist_items where id = (p_op->>'id')::uuid and task_id = p_task;
    if not found then raise exception 'Checklist item not found.'; end if;

  elsif v_op = 'comment' then
    v_text := left(trim(coalesce(p_op->>'body', '')), 4000);
    if v_text = '' then raise exception 'Write the comment first.'; end if;
    insert into public.comments (task_id, user_id, body) values (p_task, v_me, v_text);

  else
    raise exception 'Unknown change.';
  end if;
end;
$$;
revoke all on function public.task_hub_apply(uuid, jsonb) from public, anon, authenticated;

-- Dashboard (as the owner).
create or replace function public.dashboard_task_detail(p_key text, p_task uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_out jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    v_out := public.task_hub_detail(p_task);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_out;
end;
$$;
revoke all on function public.dashboard_task_detail(text, uuid) from public;
grant execute on function public.dashboard_task_detail(text, uuid) to anon, authenticated;

create or replace function public.dashboard_task_apply(p_key text, p_task uuid, p_op jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    perform public.task_hub_apply(p_task, p_op);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_task_apply(text, uuid, jsonb) from public;
grant execute on function public.dashboard_task_apply(text, uuid, jsonb) to anon, authenticated;

-- ERPs (as the ERP user, inside the key's workspace).
create or replace function public.erp_task_detail(p_key text, p_email text, p_task uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_out jsonb;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    perform public.erp_task_project(v_ws, p_task);
    v_out := public.task_hub_detail(p_task);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_out;
end;
$$;
revoke all on function public.erp_task_detail(text, text, uuid) from public;
grant execute on function public.erp_task_detail(text, text, uuid) to anon, authenticated;

create or replace function public.erp_task_apply(p_key text, p_email text, p_task uuid, p_op jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    perform public.erp_task_project(v_ws, p_task);
    perform public.task_hub_apply(p_task, p_op);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.erp_task_apply(text, text, uuid, jsonb) from public;
grant execute on function public.erp_task_apply(text, text, uuid, jsonb) to anon, authenticated;
