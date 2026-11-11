-- Dashboard SS Tasks panel, Planner-style moves and quick edits:
-- dashboard_tasks now also returns each task's column (bucket) name, and
-- dashboard_task_update changes a task's title, due date, priority, project
-- or column as the owner (only tasks the owner can see; only into projects
-- the owner can see). Guarded by the dashboard key.

create or replace function public.dashboard_tasks(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  return (
    with visible as (
      select t.*, p.name as project_name, p.color as project_color, w.name as workspace_name,
             (select b.name from public.buckets b where b.id = t.bucket_id) as bucket_name
      from public.tasks t
      join public.projects p on p.id = t.project_id and not p.archived
      join public.workspaces w on w.id = p.workspace_id
      join public.workspace_members m on m.workspace_id = w.id and m.user_id = v_me
      where not t.done
        and (m.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_me))
    ),
    shaped as (
      select v.*,
        exists (select 1 from public.task_assignees a where a.task_id = v.id and a.user_id = v_me) as mine,
        (v.created_by = v_me and exists (select 1 from public.task_assignees a where a.task_id = v.id and a.user_id <> v_me)) as by_me,
        (select coalesce(jsonb_agg(pr.full_name order by pr.full_name), '[]'::jsonb)
           from public.task_assignees a join public.profiles pr on pr.id = a.user_id where a.task_id = v.id) as assignees,
        (select count(*) from public.checklist_items c where c.task_id = v.id) as checks,
        (select count(*) from public.checklist_items c where c.task_id = v.id and c.done) as checked
      from visible v
    )
    select jsonb_build_object('tasks', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'due', due_date, 'priority', priority,
      'project_id', project_id, 'project', project_name, 'color', project_color, 'workspace', workspace_name,
      'mine', mine, 'by_me', by_me, 'assignees', assignees, 'checks', checks, 'checked', checked,
      'bucket', bucket_name
    ) order by due_date nulls last, created_at), '[]'::jsonb))
    from shaped where mine or by_me
  );
end;
$$;
revoke all on function public.dashboard_tasks(text) from public;
grant execute on function public.dashboard_tasks(text) to anon, authenticated;

create or replace function public.dashboard_task_update(p_key text, p_task uuid, p_patch jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_task public.tasks;
  v_project uuid;
  v_bucket uuid;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    select * into v_task from public.tasks where id = p_task;

    if p_patch ? 'project' and (p_patch->>'project')::uuid is distinct from v_task.project_id then
      v_project := (p_patch->>'project')::uuid;
      if not public.can_see_project(v_project) then raise exception 'Project not found.'; end if;
      select id into v_bucket from public.buckets where project_id = v_project
       order by (v_task.done and lower(name) = 'done') desc, position limit 1;
      update public.tasks set project_id = v_project, bucket_id = v_bucket where id = p_task;
      v_task.project_id := v_project;
    end if;

    if p_patch ? 'bucket' then
      select id into v_bucket from public.buckets
       where project_id = v_task.project_id and lower(name) = lower(p_patch->>'bucket') limit 1;
      if v_bucket is null then raise exception 'This project has no "%" column.', p_patch->>'bucket'; end if;
      update public.tasks set bucket_id = v_bucket, done = (lower(p_patch->>'bucket') = 'done') where id = p_task;
    end if;

    update public.tasks
       set title = case when p_patch ? 'title' and length(trim(p_patch->>'title')) > 0 then left(trim(p_patch->>'title'), 300) else title end,
           due_date = case when p_patch ? 'due' then (p_patch->>'due')::date else due_date end,
           priority = case when p_patch ? 'priority' then nullif(p_patch->>'priority', '')::public.task_priority else priority end
     where id = p_task and (p_patch ? 'title' or p_patch ? 'due' or p_patch ? 'priority');
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_task_update(text, uuid, jsonb) from public;
grant execute on function public.dashboard_task_update(text, uuid, jsonb) to anon, authenticated;
