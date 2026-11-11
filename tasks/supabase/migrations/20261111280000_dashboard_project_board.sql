-- The whole project as a Planner-style board inside the dashboard: its
-- columns (buckets) and every task the owner may see in it (project owners
-- see all tasks; members their own — can_see_task_row), done ones included.

create or replace function public.dashboard_project_board(p_key text, p_project uuid)
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
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    select jsonb_build_object(
      'project', jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'workspace', w.name),
      'can_manage', public.can_manage_project(p.id),
      'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.position, b.name)
                             from public.buckets b where b.project_id = p.id), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.title, 'bucket_id', t.bucket_id, 'done', t.done,
                 'due', t.due_date, 'time', to_char(t.due_time, 'HH24:MI'), 'priority', t.priority,
                 'assignees', coalesce((select jsonb_agg(coalesce(nullif(pr.full_name, ''), pr.email) order by pr.full_name)
                                          from public.task_assignees a join public.profiles pr on pr.id = a.user_id
                                         where a.task_id = t.id), '[]'::jsonb),
                 'checks', (select count(*) from public.checklist_items c where c.task_id = t.id),
                 'checked', (select count(*) from public.checklist_items c where c.task_id = t.id and c.done))
               order by t.done, t.position, t.created_at)
          from public.tasks t
         where t.project_id = p.id and public.can_see_task_row(t.project_id, t.created_by, t.id)), '[]'::jsonb))
      into v_out
      from public.projects p join public.workspaces w on w.id = p.workspace_id
     where p.id = p_project;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_out;
end;
$$;
revoke all on function public.dashboard_project_board(text, uuid) from public;
grant execute on function public.dashboard_project_board(text, uuid) to anon, authenticated;
