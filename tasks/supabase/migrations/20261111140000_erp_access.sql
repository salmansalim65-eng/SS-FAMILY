-- Task Hub inside the company ERPs (RMI, MBL, …). Each ERP server holds its
-- own key; erp_keys stores only the key's SHA-256 and the one workspace that
-- key may reach. The ERP passes the signed-in ERP user's email; every call
-- runs as that Task Hub user (impersonated), so RLS-style checks
-- (can_see_project / can_see_task) apply, and only inside that workspace.

create table if not exists public.erp_keys (
  name text primary key,                -- 'RMI', 'MBL', …
  key_hash text not null unique,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.erp_keys enable row level security;
revoke all on public.erp_keys from anon, authenticated;

-- The workspace a key opens, or an error.
create or replace function public.erp_workspace(p_key text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.erp_keys
   where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  if v_ws is null then raise exception 'Task Hub key is not valid' using errcode = '42501'; end if;
  return v_ws;
end;
$$;
revoke all on function public.erp_workspace(text) from public, anon, authenticated;

create or replace function public.erp_user(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles where lower(email) = lower(trim(coalesce(p_email, ''))) limit 1;
$$;
revoke all on function public.erp_user(text) from public, anon, authenticated;

-- My tasks in this company's workspace: open tasks assigned to the user, or
-- given by them to others; plus the projects they can add tasks to.
create or replace function public.erp_my_tasks(p_key text, p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_role public.member_role;
begin
  select role into v_role from public.workspace_members where workspace_id = v_ws and user_id = v_me;
  if v_me is null or v_role is null then
    return jsonb_build_object('workspace', (select name from public.workspaces where id = v_ws), 'member', false, 'tasks', '[]'::jsonb, 'projects', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'workspace', (select name from public.workspaces where id = v_ws),
    'member', true,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color) order by p.name)
        from public.projects p
       where p.workspace_id = v_ws and not p.archived
         and (v_role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_me))
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'due', t.due_date, 'priority', t.priority,
               'project_id', p.id, 'project', p.name, 'color', p.color,
               'bucket', (select b.name from public.buckets b where b.id = t.bucket_id),
               'mine', exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_me),
               'assignees', (select coalesce(jsonb_agg(coalesce(nullif(pr.full_name, ''), pr.email) order by pr.full_name), '[]'::jsonb)
                               from public.task_assignees a join public.profiles pr on pr.id = a.user_id where a.task_id = t.id),
               'checks', (select count(*) from public.checklist_items c where c.task_id = t.id),
               'checked', (select count(*) from public.checklist_items c where c.task_id = t.id and c.done))
             order by t.due_date nulls last, t.created_at)
        from public.tasks t
        join public.projects p on p.id = t.project_id and p.workspace_id = v_ws and not p.archived
       where not t.done
         and (v_role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = v_me))
         and (exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_me)
              or (t.created_by = v_me and exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id <> v_me)))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.erp_my_tasks(text, text) from public;
grant execute on function public.erp_my_tasks(text, text) to anon, authenticated;

-- Tick a task done / open, as the user, inside this workspace only.
create or replace function public.erp_task_done(p_key text, p_email text, p_task uuid, p_done boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  if not exists (select 1 from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_task and p.workspace_id = v_ws) then
    raise exception 'Task not found.';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
    perform public.sync_set_done(p_task, p_done);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.erp_task_done(text, text, uuid, boolean) from public;
grant execute on function public.erp_task_done(text, text, uuid, boolean) to anon, authenticated;

-- Add a task to one of this workspace's projects, assigned to the user.
create or replace function public.erp_task_create(p_key text, p_email text, p_project uuid, p_title text, p_due date)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
  v_claims text := current_setting('request.jwt.claims', true);
  v_bucket uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'You are not in Task Hub yet.'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'A task needs a title.'; end if;
  if not exists (select 1 from public.projects where id = p_project and workspace_id = v_ws) then raise exception 'Project not found.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    select id into v_bucket from public.buckets where project_id = p_project order by position limit 1;
    insert into public.tasks (project_id, bucket_id, title, due_date, created_by, position)
    values (p_project, v_bucket, left(trim(p_title), 300), p_due, v_me, extract(epoch from now()))
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
revoke all on function public.erp_task_create(text, text, uuid, text, date) from public;
grant execute on function public.erp_task_create(text, text, uuid, text, date) to anon, authenticated;
