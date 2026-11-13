-- Drag and drop on the dashboard's project board.
--  * dashboard_task_place: put a task into a column, before another task
--    (or at the end of the column's open tasks). Moving into another column
--    goes through task_hub_apply, so "Done" still completes the task.
--  * dashboard_bucket_move: put a column before another one (or last);
--    project owners only, the same as the other column changes.

create or replace function public.dashboard_task_place(p_key text, p_task uuid, p_bucket uuid, p_before uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  t public.tasks;
  v_before double precision;
  v_prev double precision;
  v_pos double precision;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    select * into t from public.tasks where id = p_task;
    if not exists (select 1 from public.buckets where id = p_bucket and project_id = t.project_id) then
      raise exception 'That column is not in this project.';
    end if;
    if t.bucket_id is distinct from p_bucket then
      perform public.task_hub_apply(p_task, jsonb_build_object('op', 'set', 'bucket', p_bucket));
    end if;
    if p_before is not null then
      -- The board shows a task with no column in the first one, so only the
      -- project is checked here.
      select position into v_before from public.tasks
       where id = p_before and project_id = t.project_id and id <> p_task;
    end if;
    if v_before is null then
      select max(position) + 1 into v_pos from public.tasks
       where bucket_id = p_bucket and not done and id <> p_task;
    else
      select max(position) into v_prev from public.tasks
       where bucket_id = p_bucket and not done and id <> p_task and id <> p_before and position < v_before;
      v_pos := case when v_prev is null then v_before - 1 else (v_prev + v_before) / 2 end;
    end if;
    update public.tasks set position = coalesce(v_pos, 1) where id = p_task;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_task_place(text, uuid, uuid, uuid) from public;
grant execute on function public.dashboard_task_place(text, uuid, uuid, uuid) to anon, authenticated;

create or replace function public.dashboard_bucket_move(p_key text, p_project uuid, p_bucket uuid, p_before uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_order uuid[];
  v_at int;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    if not public.can_manage_project(p_project) then raise exception 'Only the project owner can change its columns.'; end if;
    if not exists (select 1 from public.buckets where id = p_bucket and project_id = p_project) then
      raise exception 'That column is not in this project.';
    end if;
    select array_agg(id order by position, name) into v_order
      from public.buckets where project_id = p_project and id <> p_bucket;
    v_at := coalesce(array_position(v_order, p_before), coalesce(array_length(v_order, 1), 0) + 1);
    v_order := coalesce(v_order[1:v_at - 1], '{}') || p_bucket || coalesce(v_order[v_at:], '{}');
    update public.buckets b set position = o.n
      from unnest(v_order) with ordinality as o(id, n)
     where b.id = o.id and b.position is distinct from o.n;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_bucket_move(text, uuid, uuid, uuid) from public;
grant execute on function public.dashboard_bucket_move(text, uuid, uuid, uuid) to anon, authenticated;
