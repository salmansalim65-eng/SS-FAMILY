-- Buckets (columns) get their own due date and members, and a new bucket
-- can be created with its tasks in one go. Tasks no longer go to their
-- creator by default.
--
--  * buckets.due_date; bucket_members (who works on the bucket).
--  * A bucket's members see every task in it (can_see_task_row), as well as
--    their own tasks and, for project owners, everything.
--  * dashboard_bucket_create(name, due, members, tasks): the tasks are
--    created unassigned, with the bucket's due date.
--  * dashboard_bucket_settings(bucket, name, due, members).
--  * dashboard_project_board returns each bucket's due date and members.
--  * dashboard_task_create and erp_task_add no longer assign the creator.
--    An unassigned task the owner created still shows under "To me" on the
--    dashboard (dashboard_tasks).

alter table public.buckets add column if not exists due_date date;

create table if not exists public.bucket_members (
  bucket_id uuid not null references public.buckets (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (bucket_id, user_id)
);
create index if not exists bucket_members_user on public.bucket_members (user_id);
alter table public.bucket_members enable row level security;
drop policy if exists "see bucket members" on public.bucket_members;
create policy "see bucket members" on public.bucket_members for select to authenticated
  using (public.can_see_project((select b.project_id from public.buckets b where b.id = bucket_id)));
drop policy if exists "owners edit bucket members" on public.bucket_members;
create policy "owners edit bucket members" on public.bucket_members for all to authenticated
  using (public.is_project_owner((select b.project_id from public.buckets b where b.id = bucket_id), auth.uid()))
  with check (public.is_project_owner((select b.project_id from public.buckets b where b.id = bucket_id), auth.uid()));
grant select, insert, delete on public.bucket_members to authenticated;

-- Who sees a task: its creator, its assignees, the members of its bucket and
-- the project's owners (all of them still in the project).
create or replace function public.can_see_task_row(p_project uuid, p_created_by uuid, p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_project(p_project)
     and (p_created_by = auth.uid()
          or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.user_id = auth.uid())
          or exists (select 1 from public.tasks t join public.bucket_members bm on bm.bucket_id = t.bucket_id
                      where t.id = p_task and bm.user_id = auth.uid())
          or public.is_project_owner(p_project, auth.uid()));
$$;

-- Sets a bucket's members to exactly p_members (project members only).
create or replace function public.set_bucket_members(p_bucket uuid, p_members uuid[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_project uuid;
begin
  select project_id into v_project from public.buckets where id = p_bucket;
  if exists (select 1 from unnest(coalesce(p_members, '{}')) u
              where not exists (select 1 from public.project_members pm where pm.project_id = v_project and pm.user_id = u)) then
    raise exception 'Someone you chose is not a member of this project.';
  end if;
  delete from public.bucket_members where bucket_id = p_bucket and not (user_id = any(coalesce(p_members, '{}')));
  insert into public.bucket_members (bucket_id, user_id)
  select p_bucket, u from unnest(coalesce(p_members, '{}')) u on conflict do nothing;
end;
$$;
revoke all on function public.set_bucket_members(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.dashboard_bucket_create(p_key text, p_project uuid, p_name text, p_due date, p_members uuid[], p_tasks text[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_name text := left(trim(coalesce(p_name, '')), 80);
  v_bucket uuid;
  v_title text;
  v_i int := 0;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  if v_name = '' then raise exception 'Give the bucket a name.'; end if;
  if cardinality(coalesce(p_tasks, '{}')) > 100 then raise exception 'Too many tasks at once.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    if not public.can_manage_project(p_project) then raise exception 'Only the project owner can add buckets.'; end if;
    insert into public.buckets (project_id, name, position, due_date)
    values (p_project, v_name, coalesce((select max(position) from public.buckets where project_id = p_project), 0) + 1, p_due)
    returning id into v_bucket;
    perform public.set_bucket_members(v_bucket, p_members);
    foreach v_title in array coalesce(p_tasks, '{}') loop
      v_title := left(trim(v_title), 300);
      continue when v_title = '';
      v_i := v_i + 1;
      insert into public.tasks (project_id, bucket_id, title, due_date, created_by, position)
      values (p_project, v_bucket, v_title, p_due, v_me, v_i);
    end loop;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_bucket;
end;
$$;
revoke all on function public.dashboard_bucket_create(text, uuid, text, date, uuid[], text[]) from public;
grant execute on function public.dashboard_bucket_create(text, uuid, text, date, uuid[], text[]) to anon, authenticated;

create or replace function public.dashboard_bucket_settings(p_key text, p_project uuid, p_bucket uuid, p_name text, p_due date, p_members uuid[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_name text := left(trim(coalesce(p_name, '')), 80);
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  if v_name = '' then raise exception 'Give the bucket a name.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    if not public.can_manage_project(p_project) then raise exception 'Only the project owner can change buckets.'; end if;
    update public.buckets set name = v_name, due_date = p_due where id = p_bucket and project_id = p_project;
    if not found then raise exception 'That bucket is not in this project.'; end if;
    perform public.set_bucket_members(p_bucket, p_members);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_bucket_settings(text, uuid, uuid, text, date, uuid[]) from public;
grant execute on function public.dashboard_bucket_settings(text, uuid, uuid, text, date, uuid[]) to anon, authenticated;

-- The board: buckets carry their due date and members; the project's people
-- come along for the pickers.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.dashboard_project_board(text, uuid)'::regprocedure);
  if v_def like '%''members''%' then return; end if;
  v_new := replace(v_def,
    '''buckets'', coalesce((select jsonb_agg(jsonb_build_object(''id'', b.id, ''name'', b.name) order by b.position, b.name)',
    '''people'', public.erp_project_people(p.id),
      ''buckets'', coalesce((select jsonb_agg(jsonb_build_object(''id'', b.id, ''name'', b.name, ''due'', b.due_date,
                                ''members'', coalesce((select jsonb_agg(bm.user_id) from public.bucket_members bm where bm.bucket_id = b.id), ''[]''::jsonb))
                              order by b.position, b.name)');
  if v_new = v_def then raise exception 'Could not patch dashboard_project_board'; end if;
  execute v_new;
end;
$$;

-- No automatic assignment to the creator.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.dashboard_task_create(text, uuid, text, date, text)'::regprocedure);
  v_new := replace(v_def, '    insert into public.task_assignees (task_id, user_id, assigned_by) values (v_id, v_me, v_me);
', '');
  if v_new <> v_def then execute v_new; end if;

  v_def := pg_get_functiondef('public.erp_task_add(text, text, uuid, text, date, uuid[])'::regprocedure);
  v_new := replace(v_def, '  if cardinality(v_people) = 0 then v_people := array[v_me]; end if;
', '');
  if v_new <> v_def then execute v_new; end if;

  -- "To me" on the dashboard: assigned to the owner, or made by the owner and
  -- not assigned to anyone yet.
  v_def := pg_get_functiondef('public.dashboard_tasks(text)'::regprocedure);
  v_new := replace(v_def,
    'exists (select 1 from public.task_assignees a where a.task_id = v.id and a.user_id = v_me) as mine',
    '(exists (select 1 from public.task_assignees a where a.task_id = v.id and a.user_id = v_me)
         or (v.created_by = v_me and not exists (select 1 from public.task_assignees a where a.task_id = v.id))) as mine');
  if v_new = v_def and v_def not like '%not exists (select 1 from public.task_assignees a where a.task_id = v.id))) as mine%' then
    raise exception 'Could not patch dashboard_tasks';
  end if;
  if v_new <> v_def then execute v_new; end if;
end;
$$;
