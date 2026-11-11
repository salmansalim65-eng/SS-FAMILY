-- Assigning tasks from the dashboard panel: dashboard_tasks also returns
-- each task's assignee ids; dashboard_projects also lists who can be given
-- tasks in each project (workspace members, plus guests added to that
-- project); dashboard_task_assign adds or removes one assignee, as the
-- owner (so the usual "assigned you a task" notification goes out).

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
        (select coalesce(jsonb_agg(a.user_id), '[]'::jsonb) from public.task_assignees a where a.task_id = v.id) as assignee_ids,
        (select count(*) from public.checklist_items c where c.task_id = v.id) as checks,
        (select count(*) from public.checklist_items c where c.task_id = v.id and c.done) as checked
      from visible v
    )
    select jsonb_build_object('tasks', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'due', due_date, 'priority', priority,
      'project_id', project_id, 'project', project_name, 'color', project_color, 'workspace', workspace_name,
      'mine', mine, 'by_me', by_me, 'assignees', assignees, 'checks', checks, 'checked', checked,
      'bucket', bucket_name, 'assignee_ids', assignee_ids
    ) order by due_date nulls last, created_at), '[]'::jsonb))
    from shaped where mine or by_me
  );
end;
$$;
revoke all on function public.dashboard_tasks(text) from public;
grant execute on function public.dashboard_tasks(text) to anon, authenticated;

create or replace function public.dashboard_projects(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.home_dashboard_owner();
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.name, 'color', p.color, 'workspace', w.name,
             'people', coalesce((
               select jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.email)) order by pr.full_name)
                 from public.workspace_members wm
                 join public.profiles pr on pr.id = wm.user_id
                where wm.workspace_id = w.id
                  and (wm.role <> 'guest' or exists (select 1 from public.project_members pm2 where pm2.project_id = p.id and pm2.user_id = wm.user_id))
             ), '[]'::jsonb))
           order by w.name, p.name)
      from public.projects p
      join public.workspaces w on w.id = p.workspace_id
      join public.workspace_members m on m.workspace_id = w.id and m.user_id = v_me
     where not p.archived
       and (m.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_me))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.dashboard_projects(text) from public;
grant execute on function public.dashboard_projects(text) to anon, authenticated;

create or replace function public.dashboard_task_assign(p_key text, p_task uuid, p_user uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_project uuid;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    select project_id into v_project from public.tasks where id = p_task;
    if p_on then
      if not exists (
        select 1 from public.workspace_members wm
          join public.projects p on p.workspace_id = wm.workspace_id and p.id = v_project
         where wm.user_id = p_user
           and (wm.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = v_project and pm.user_id = p_user))
      ) then raise exception 'That person is not on this project.'; end if;
      insert into public.task_assignees (task_id, user_id, assigned_by) values (p_task, p_user, v_me) on conflict do nothing;
    else
      delete from public.task_assignees where task_id = p_task and user_id = p_user;
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_task_assign(text, uuid, uuid, boolean) from public;
grant execute on function public.dashboard_task_assign(text, uuid, uuid, boolean) to anon, authenticated;
