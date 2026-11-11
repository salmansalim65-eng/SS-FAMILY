-- For the dashboard's SS Tasks panel: the owner's projects (for "add task"
-- and the project headings' colours) and adding a task, assigned to the
-- owner, as the owner. Guarded by the dashboard key like the others.

create or replace function public.dashboard_projects(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.home_dashboard_owner();
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'workspace', w.name)
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

create or replace function public.dashboard_task_create(p_key text, p_project uuid, p_title text, p_due date, p_priority text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_bucket uuid;
  v_id uuid;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'A task needs a title.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    select id into v_bucket from public.buckets where project_id = p_project order by position limit 1;
    insert into public.tasks (project_id, bucket_id, title, due_date, priority, created_by, position)
    values (p_project, v_bucket, left(trim(p_title), 300), p_due,
            nullif(p_priority, '')::public.task_priority, v_me, extract(epoch from now()))
    returning id into v_id;
    insert into public.task_assignees (task_id, user_id, assigned_by) values (v_id, v_me, v_me);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_id;
end;
$$;
revoke all on function public.dashboard_task_create(text, uuid, text, date, text) from public;
grant execute on function public.dashboard_task_create(text, uuid, text, date, text) to anon, authenticated;
