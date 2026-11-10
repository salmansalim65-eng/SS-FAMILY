-- For the owner's SS Dashboard: their open tasks (assigned to them, and those
-- they assigned to others) and ticking a task done, guarded by a shared key
-- whose SHA-256 is kept in home_dashboard_key. Runs as the owner, so it sees
-- and changes only what the owner can.

create table if not exists public.home_dashboard_key (
  id boolean primary key default true check (id),
  key_hash text not null
);
alter table public.home_dashboard_key enable row level security;
revoke all on public.home_dashboard_key from anon, authenticated;

create or replace function public.home_dashboard_check(p_key text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or not exists (
    select 1 from public.home_dashboard_key where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'dashboard key is not valid' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.home_dashboard_check(text) from public, anon, authenticated;

create or replace function public.home_dashboard_owner()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles where email = 'salmansalim65@gmail.com';
$$;
revoke all on function public.home_dashboard_owner() from public, anon, authenticated;

create or replace function public.dashboard_tasks(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  return (
    with visible as (
      select t.*, p.name as project_name, p.color as project_color, w.name as workspace_name
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
      'mine', mine, 'by_me', by_me, 'assignees', assignees, 'checks', checks, 'checked', checked
    ) order by due_date nulls last, created_at), '[]'::jsonb))
    from shaped where mine or by_me
  );
end;
$$;
revoke all on function public.dashboard_tasks(text) from public;
grant execute on function public.dashboard_tasks(text) to anon, authenticated;

-- Ticks a task done (or open again) as the owner; moves it into / out of a "Done" column like the board does.
create or replace function public.dashboard_task_done(p_key text, p_task uuid, p_done boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_project uuid;
  v_done_bucket uuid;
  v_first uuid;
begin
  perform public.home_dashboard_check(p_key);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    select project_id into v_project from public.tasks where id = p_task;
    select id into v_done_bucket from public.buckets where project_id = v_project and lower(name) = 'done' limit 1;
    select id into v_first from public.buckets where project_id = v_project order by position limit 1;
    update public.tasks
       set done = p_done,
           bucket_id = case when v_done_bucket is null then bucket_id
                            when p_done then v_done_bucket
                            when bucket_id = v_done_bucket then v_first
                            else bucket_id end
     where id = p_task;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_task_done(text, uuid, boolean) from public;
grant execute on function public.dashboard_task_done(text, uuid, boolean) to anon, authenticated;
