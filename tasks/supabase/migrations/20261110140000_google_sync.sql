-- Two-way sync between the owner's SS Tasks and their Google Tasks, run by
-- the SS Dashboard (which holds the Google connection), guarded by the same
-- dashboard key. Every Google list maps to a project in the owner's
-- "Personal" workspace; the Google list "SS Tasks" holds the owner's tasks
-- from every other project, and tasks added to it land in Personal › Inbox.

create table if not exists public.google_sync_settings (
  id boolean primary key default true check (id),
  workspace_id uuid references public.workspaces (id) on delete set null,
  inbox_list text,
  inbox_project uuid references public.projects (id) on delete set null,
  last_sync_at timestamptz
);

create table if not exists public.google_sync_lists (
  google_list text primary key,
  project_id uuid not null references public.projects (id) on delete cascade
);

create table if not exists public.google_sync_links (
  task_id uuid primary key,
  google_list text not null,
  google_task text not null,
  done boolean not null default false,
  gone boolean not null default false, -- deleted in Google: kept so it isn't copied back
  synced_at timestamptz not null default now(),
  unique (google_list, google_task)
);

alter table public.google_sync_settings enable row level security;
alter table public.google_sync_lists enable row level security;
alter table public.google_sync_links enable row level security;
revoke all on public.google_sync_settings, public.google_sync_lists, public.google_sync_links from anon, authenticated;

-- Lets one sync run at a time, at most every p_seconds.
create or replace function public.dashboard_sync_claim(p_key text, p_seconds int default 60)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_ok boolean;
begin
  perform public.home_dashboard_check(p_key);
  insert into public.google_sync_settings (id) values (true) on conflict do nothing;
  update public.google_sync_settings set last_sync_at = now()
   where last_sync_at is null or last_sync_at < now() - make_interval(secs => greatest(p_seconds, 5))
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;
revoke all on function public.dashboard_sync_claim(text, int) from public;
grant execute on function public.dashboard_sync_claim(text, int) to anon, authenticated;

-- What the sync needs: settings, list map, the owner's tasks with their links, and links whose task is gone.
create or replace function public.dashboard_sync_state(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.home_dashboard_owner();
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.google_sync_settings s),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('google_list', l.google_list, 'project_id', l.project_id))
                         from public.google_sync_lists l), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'notes', t.notes, 'due', t.due_date, 'done', t.done,
               'updated_at', t.updated_at, 'project_id', t.project_id,
               'link', (select to_jsonb(k) - 'task_id' from public.google_sync_links k where k.task_id = t.id)))
        from public.tasks t
        join public.projects p on p.id = t.project_id and not p.archived
       where exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_me)
         -- open tasks, plus done ones still linked (recent ones, so re-opening in Google comes back)
         and (not t.done or exists (select 1 from public.google_sync_links k
                                     where k.task_id = t.id and not k.gone
                                       and (not k.done or t.done_at > now() - interval '30 days')))
    ), '[]'::jsonb),
    'orphans', coalesce((
      select jsonb_agg(to_jsonb(k))
        from public.google_sync_links k
       where not k.gone and not exists (
               select 1 from public.tasks t join public.projects p on p.id = t.project_id and not p.archived
                where t.id = k.task_id
                  and exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = v_me))
    ), '[]'::jsonb),
    'linked', coalesce((select jsonb_agg(k.google_task) from public.google_sync_links k), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.dashboard_sync_state(text) from public;
grant execute on function public.dashboard_sync_state(text) to anon, authenticated;

-- A project in the owner's Personal workspace (made on first use), with its three columns.
create or replace function public.sync_personal_project(p_title text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_ws uuid;
  v_project uuid;
  v_colors text[] := array['#0ea5e9','#8b5cf6','#22c55e','#f59e0b','#ec4899','#14b8a6','#f97316','#6366f1','#ef4444','#64748b'];
begin
  insert into public.google_sync_settings (id) values (true) on conflict do nothing;
  select workspace_id into v_ws from public.google_sync_settings;
  if v_ws is null or not exists (select 1 from public.workspaces where id = v_ws) then
    insert into public.workspaces (name, color, created_by) values ('Personal', '#22c55e', v_me) returning id into v_ws;
    update public.google_sync_settings set workspace_id = v_ws where id;
  end if;
  insert into public.projects (workspace_id, name, color, created_by)
  values (v_ws, left(coalesce(nullif(trim(p_title), ''), 'Tasks'), 120),
          v_colors[1 + (select count(*) from public.projects where workspace_id = v_ws) % 10], v_me)
  returning id into v_project;
  return v_project;
end;
$$;
revoke all on function public.sync_personal_project(text) from public, anon, authenticated;

-- Marks a task done / open, moving it into or out of its project's Done column.
create or replace function public.sync_set_done(p_task uuid, p_done boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_project uuid; v_done uuid; v_first uuid;
begin
  select project_id into v_project from public.tasks where id = p_task;
  select id into v_done from public.buckets where project_id = v_project and lower(name) = 'done' limit 1;
  select id into v_first from public.buckets where project_id = v_project order by position limit 1;
  update public.tasks
     set done = p_done,
         bucket_id = case when v_done is null then bucket_id
                          when p_done then v_done
                          when bucket_id = v_done then v_first
                          else bucket_id end
   where id = p_task and done is distinct from p_done;
end;
$$;
revoke all on function public.sync_set_done(uuid, boolean) from public, anon, authenticated;

-- Applies a batch of sync steps as the owner; returns one result per step.
--   {op:'inbox', google_list}                       the Google "SS Tasks" list ↔ Personal › Inbox
--   {op:'map_list', google_list, title}             a Google list → a new Personal project
--   {op:'link', task_id, google_list, google_task, done}
--   {op:'gone', task_id}                            deleted in Google
--   {op:'unlink', task_id}
--   {op:'update', task_id, title?, notes?, due?, done?}
--   {op:'create', google_list, google_task, title, notes, due, done, priority, checklist:[{title,done}]}
create or replace function public.dashboard_sync_apply(p_key text, p_ops jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_op jsonb;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
  v_project uuid;
  v_bucket uuid;
  v_item jsonb;
  v_pos int;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb)) loop
      v_id := null;
      begin
      case v_op->>'op'
      when 'inbox' then
        insert into public.google_sync_settings (id) values (true) on conflict do nothing;
        select inbox_project into v_project from public.google_sync_settings;
        if v_project is null or not exists (select 1 from public.projects where id = v_project) then
          v_project := public.sync_personal_project('Inbox');
        end if;
        update public.google_sync_settings set inbox_list = v_op->>'google_list', inbox_project = v_project where id;
        insert into public.google_sync_lists (google_list, project_id) values (v_op->>'google_list', v_project)
        on conflict (google_list) do update set project_id = excluded.project_id;
        v_id := v_project;
      when 'map_list' then
        v_project := public.sync_personal_project(v_op->>'title');
        insert into public.google_sync_lists (google_list, project_id) values (v_op->>'google_list', v_project)
        on conflict (google_list) do update set project_id = excluded.project_id;
        v_id := v_project;
      when 'link' then
        insert into public.google_sync_links (task_id, google_list, google_task, done, synced_at)
        values ((v_op->>'task_id')::uuid, v_op->>'google_list', v_op->>'google_task', coalesce((v_op->>'done')::boolean, false), now())
        on conflict (task_id) do update
          set google_list = excluded.google_list, google_task = excluded.google_task,
              done = excluded.done, gone = false, synced_at = now();
        v_id := (v_op->>'task_id')::uuid;
      when 'gone' then
        update public.google_sync_links set gone = true, synced_at = now() where task_id = (v_op->>'task_id')::uuid;
      when 'unlink' then
        delete from public.google_sync_links where task_id = (v_op->>'task_id')::uuid;
      when 'update' then
        v_id := (v_op->>'task_id')::uuid;
        if not public.can_see_task(v_id) then raise exception 'Task not found.'; end if;
        update public.tasks
           set title = case when v_op ? 'title' and length(trim(v_op->>'title')) > 0 then left(trim(v_op->>'title'), 300) else title end,
               notes = case when v_op ? 'notes' then coalesce(v_op->>'notes', '') else notes end,
               due_date = case when v_op ? 'due' then (v_op->>'due')::date else due_date end
         where id = v_id
           and (v_op ? 'title' or v_op ? 'notes' or v_op ? 'due');
        if v_op ? 'done' then perform public.sync_set_done(v_id, (v_op->>'done')::boolean); end if;
      when 'create' then
        select project_id into v_project from public.google_sync_lists where google_list = v_op->>'google_list';
        if v_project is null then raise exception 'Google list is not mapped.'; end if;
        select id into v_bucket from public.buckets where project_id = v_project order by position limit 1;
        insert into public.tasks (project_id, bucket_id, title, notes, due_date, priority, created_by, position)
        values (v_project, v_bucket, left(trim(v_op->>'title'), 300), coalesce(v_op->>'notes', ''),
                (v_op->>'due')::date, nullif(v_op->>'priority', '')::public.task_priority, v_me,
                extract(epoch from now()))
        returning id into v_id;
        insert into public.task_assignees (task_id, user_id, assigned_by) values (v_id, v_me, v_me);
        v_pos := 0;
        for v_item in select * from jsonb_array_elements(coalesce(v_op->'checklist', '[]'::jsonb)) loop
          v_pos := v_pos + 1;
          if length(trim(coalesce(v_item->>'title', ''))) > 0 then
            insert into public.checklist_items (task_id, title, done, position)
            values (v_id, left(trim(v_item->>'title'), 300), coalesce((v_item->>'done')::boolean, false), v_pos);
          end if;
        end loop;
        if coalesce((v_op->>'done')::boolean, false) then perform public.sync_set_done(v_id, true); end if;
        insert into public.google_sync_links (task_id, google_list, google_task, done, synced_at)
        values (v_id, v_op->>'google_list', v_op->>'google_task', coalesce((v_op->>'done')::boolean, false), now())
        on conflict do nothing;
      else
        raise exception 'Unknown sync step %', v_op->>'op';
      end case;
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id));
      exception when others then
        -- One bad step is reported and skipped; the rest still apply.
        v_out := v_out || jsonb_build_array(jsonb_build_object('error', sqlerrm));
      end;
    end loop;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_out;
end;
$$;
revoke all on function public.dashboard_sync_apply(text, jsonb) from public;
grant execute on function public.dashboard_sync_apply(text, jsonb) to anon, authenticated;
