-- Follow-up for tasks whose due date is missed (in-app alerts only, 🔔).
--  * 1 day before the due date: "Due tomorrow" to the people doing it
--    (its assignees; the creator when nobody is assigned).
--  * 1 day late: "Late" to them and to the project owners.
--  * 7 days late: "7 days late" to them, the project owners and the
--    workspace's Mudeer.
--  * Every Monday: a weekly report to the Mudeer (late tasks, done this
--    week, postponed this week), opened at /w/<ws>/report.
--  * Moving a due date later counts as a postponement: counted on the task,
--    logged with its reason, and the project owners are told.
-- The Mudeer is chosen per workspace by its owner (workspaces.mudeer_id);
-- until chosen, the workspace owner is the Mudeer.
-- "Today" is Pakistan time. Jobs run with pg_cron at 09:00 PKT.

-- ---------------------------------------------------------------------------
-- Mudeer
-- ---------------------------------------------------------------------------
alter table public.workspaces add column if not exists mudeer_id uuid references public.profiles (id) on delete set null;

create or replace function public.workspace_mudeers(p_ws uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select w.mudeer_id from public.workspaces w
   where w.id = p_ws and w.mudeer_id is not null
     and exists (select 1 from public.workspace_members m where m.workspace_id = p_ws and m.user_id = w.mudeer_id and m.role <> 'guest')
  union
  select m.user_id from public.workspace_members m
   where m.workspace_id = p_ws and m.role = 'owner'
     and not exists (select 1 from public.workspaces w join public.workspace_members x on x.workspace_id = w.id and x.user_id = w.mudeer_id and x.role <> 'guest'
                      where w.id = p_ws);
$$;
revoke all on function public.workspace_mudeers(uuid) from public, anon, authenticated;

-- Only the workspace owner changes the Mudeer (admins may edit the rest).
create or replace function public.workspace_mudeer_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mudeer_id is distinct from old.mudeer_id and auth.uid() is not null
     and public.ws_role(new.id) is distinct from 'owner' then
    raise exception 'Only the workspace owner can choose the Mudeer.';
  end if;
  return new;
end;
$$;
drop trigger if exists workspaces_mudeer_guard on public.workspaces;
create trigger workspaces_mudeer_guard before update on public.workspaces
  for each row execute function public.workspace_mudeer_guard();

create or replace function public.set_workspace_mudeer(p_ws uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public.ws_role(p_ws) is distinct from 'owner' then raise exception 'Only the workspace owner can choose the Mudeer.'; end if;
  if p_user is not null and not exists (select 1 from public.workspace_members where workspace_id = p_ws and user_id = p_user and role <> 'guest') then
    raise exception 'The Mudeer must be a member of this workspace.';
  end if;
  update public.workspaces set mudeer_id = p_user where id = p_ws;
end;
$$;
revoke all on function public.set_workspace_mudeer(uuid, uuid) from public, anon;
grant execute on function public.set_workspace_mudeer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Postponements
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists postponed_count integer not null default 0;

create table if not exists public.task_due_changes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  old_due date not null,
  new_due date,
  reason text not null default '',
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists task_due_changes_task on public.task_due_changes (task_id, created_at desc);
alter table public.task_due_changes enable row level security;
drop policy if exists "see due changes" on public.task_due_changes;
create policy "see due changes" on public.task_due_changes for select to authenticated
  using (public.can_see_task(task_id));
grant select on public.task_due_changes to authenticated;

-- A due date moved later (or cleared) on an open task is a postponement.
-- The reason comes from the transaction setting task_hub.due_reason, which
-- postpone_task / task_hub_apply set.
create or replace function public.task_due_postponed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reason text := left(trim(coalesce(current_setting('task_hub.due_reason', true), '')), 500);
  v_who text;
begin
  if old.due_date is not null and not new.done
     and (new.due_date is null or new.due_date > old.due_date) then
    new.postponed_count := old.postponed_count + 1;
    insert into public.task_due_changes (task_id, old_due, new_due, reason, changed_by)
    values (new.id, old.due_date, new.due_date, v_reason, auth.uid());
    v_who := coalesce((select nullif(full_name, '') from public.profiles where id = auth.uid()), 'Someone');
    insert into public.notifications (user_id, kind, title, body, project_id, task_id, actor_id)
    select pm.user_id, 'postponed',
           v_who || ' moved the due date: ' || new.title,
           to_char(old.due_date, 'DD/MM/YYYY') || ' → ' || coalesce(to_char(new.due_date, 'DD/MM/YYYY'), 'no date')
             || case when v_reason <> '' then ' · ' || v_reason else ' · no reason given' end,
           new.project_id, new.id, auth.uid()
      from public.project_members pm
     where pm.project_id = new.project_id and pm.role = 'owner'
       and pm.user_id is distinct from auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_due_postponed on public.tasks;
create trigger tasks_due_postponed before update of due_date on public.tasks
  for each row execute function public.task_due_postponed();

-- Change a due date with a reason (runs with the caller's rights, so RLS applies).
create or replace function public.postpone_task(p_task uuid, p_due date, p_reason text)
returns void language plpgsql volatile security invoker set search_path = public as $$
begin
  perform set_config('task_hub.due_reason', left(trim(coalesce(p_reason, '')), 500), true);
  update public.tasks set due_date = p_due where id = p_task;
  if not found then raise exception 'Task not found.'; end if;
  perform set_config('task_hub.due_reason', '', true);
end;
$$;
revoke all on function public.postpone_task(uuid, date, text) from public, anon;
grant execute on function public.postpone_task(uuid, date, text) to authenticated;

-- task_hub_apply (dashboard + ERPs): an optional "reason" goes with "due".
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.task_hub_apply(uuid, jsonb)'::regprocedure);
  v_new := replace(v_def,
    'if p_op ? ''due'' then update public.tasks set due_date',
    'if p_op ? ''due'' then perform set_config(''task_hub.due_reason'', coalesce(p_op->>''reason'', ''''), true); update public.tasks set due_date');
  if v_new = v_def then raise exception 'Could not patch task_hub_apply'; end if;
  execute v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily alerts
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists link text;

create table if not exists public.task_followups (
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind text not null,
  due_date date not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, kind, due_date)
);
alter table public.task_followups enable row level security;  -- internal: no policies

create or replace function public.pk_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Karachi')::date; $$;

-- Sends each alert once per task per due date (postponing re-arms them).
-- Windows are a few days wide so a missed run catches up; very old late
-- tasks are left to the Late view and the weekly report.
create or replace function public.run_task_followups(p_today date default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, public.pk_today());
  r record;
  v_kind text;
  v_sent integer := 0;
  v_doers uuid[];
  v_names text;
  v_title text;
begin
  for r in
    select t.id, t.title, t.due_date, t.project_id, t.created_by, p.name as project, p.workspace_id
      from public.tasks t join public.projects p on p.id = t.project_id
     where not t.done and not p.archived
       and t.due_date between v_today - 13 and v_today + 1
       and t.due_date <> v_today
  loop
    v_kind := case when r.due_date = v_today + 1 then 'due_soon'
                   when r.due_date between v_today - 6 and v_today - 1 then 'late'
                   else 'late_7' end;
    insert into public.task_followups (task_id, kind, due_date) values (r.id, v_kind, r.due_date)
    on conflict do nothing;
    if not found then continue; end if;

    select array_agg(a.user_id) into v_doers from public.task_assignees a where a.task_id = r.id;
    if v_doers is null and r.created_by is not null then v_doers := array[r.created_by]; end if;
    select string_agg(coalesce(nullif(pr.full_name, ''), pr.email), ', ') into v_names
      from public.profiles pr where pr.id = any(coalesce(v_doers, '{}'));

    v_title := case v_kind when 'due_soon' then '⏰ Due tomorrow: '
                           when 'late' then '⚠️ Late: '
                           else '🚨 7 days late: ' end || r.title;

    insert into public.notifications (user_id, kind, title, body, project_id, task_id)
    select distinct u, v_kind, v_title,
           r.project || ' · due ' || to_char(r.due_date, 'DD/MM/YYYY') || coalesce(' · ' || v_names, ''),
           r.project_id, r.id
      from (
        select unnest(coalesce(v_doers, '{}')) as u
        union select pm.user_id from public.project_members pm
               where v_kind in ('late', 'late_7') and pm.project_id = r.project_id and pm.role = 'owner'
        union select m from public.workspace_mudeers(r.workspace_id) m where v_kind = 'late_7'
      ) x
     where exists (select 1 from public.profiles where id = u);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.run_task_followups(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Weekly report for the Mudeer
-- ---------------------------------------------------------------------------
-- Everyone's numbers in one workspace (as of p_today, Pakistan time).
create or replace function public.followup_report_data(p_ws uuid, p_today date)
returns jsonb language sql stable security definer set search_path = public as $$
  with open_late as (
    select t.*, p.name as project from public.tasks t join public.projects p on p.id = t.project_id
     where p.workspace_id = p_ws and not p.archived and not t.done and t.due_date < p_today
  ),
  doers as (
    select t.id as task_id, coalesce(a.user_id, t.created_by) as user_id
      from public.tasks t join public.projects p on p.id = t.project_id
      left join public.task_assignees a on a.task_id = t.id
     where p.workspace_id = p_ws and not p.archived
  ),
  week_done as (
    select t.id from public.tasks t join public.projects p on p.id = t.project_id
     where p.workspace_id = p_ws and t.done and t.done_at >= (p_today - 7)::timestamp at time zone 'Asia/Karachi'
  ),
  week_moved as (
    select c.task_id from public.task_due_changes c join public.tasks t on t.id = c.task_id join public.projects p on p.id = t.project_id
     where p.workspace_id = p_ws and c.created_at >= (p_today - 7)::timestamp at time zone 'Asia/Karachi'
  )
  select jsonb_build_object(
    'late', (select count(*) from open_late),
    'done_week', (select count(*) from week_done),
    'postponed_week', (select count(*) from week_moved),
    'people', coalesce((
      select jsonb_agg(x order by x.late desc, x.name) from (
        select pr.id, coalesce(nullif(pr.full_name, ''), pr.email) as name,
               (select count(*) from doers d join open_late l on l.id = d.task_id where d.user_id = pr.id) as late,
               (select count(*) from doers d join week_done w on w.id = d.task_id where d.user_id = pr.id) as done_week,
               (select count(*) from doers d join week_moved w on w.task_id = d.task_id where d.user_id = pr.id) as postponed_week
          from public.workspace_members m join public.profiles pr on pr.id = m.user_id
         where m.workspace_id = p_ws
      ) x where x.late + x.done_week + x.postponed_week > 0), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'title', l.title, 'project', l.project, 'project_id', l.project_id,
               'due', l.due_date, 'days_late', p_today - l.due_date, 'postponed', l.postponed_count,
               'can_open', public.can_see_task(l.id),
               'people', (select coalesce(jsonb_agg(coalesce(nullif(pr.full_name, ''), pr.email)), '[]'::jsonb)
                            from doers d join public.profiles pr on pr.id = d.user_id where d.task_id = l.id))
             order by l.due_date, l.title)
        from open_late l), '[]'::jsonb));
$$;
revoke all on function public.followup_report_data(uuid, date) from public, anon, authenticated;

-- The report page: for the Mudeer and the workspace owner.
create or replace function public.workspace_followup_report(p_ws uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_mudeer uuid;
begin
  if public.ws_role(p_ws) is distinct from 'owner'
     and not exists (select 1 from public.workspace_mudeers(p_ws) m where m = auth.uid()) then
    raise exception 'Only the Mudeer or the workspace owner can see this report.';
  end if;
  select mudeer_id into v_mudeer from public.workspaces where id = p_ws;
  return public.followup_report_data(p_ws, public.pk_today())
    || jsonb_build_object('today', public.pk_today(), 'mudeer_id', v_mudeer,
                          'mudeers', (select coalesce(jsonb_agg(m), '[]'::jsonb) from public.workspace_mudeers(p_ws) m),
                          'can_set', public.ws_role(p_ws) = 'owner');
end;
$$;
revoke all on function public.workspace_followup_report(uuid) from public, anon;
grant execute on function public.workspace_followup_report(uuid) to authenticated;

create or replace function public.run_weekly_followup_report(p_today date default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, public.pk_today());
  w record;
  d jsonb;
  v_sent integer := 0;
begin
  for w in select id, name from public.workspaces loop
    d := public.followup_report_data(w.id, v_today);
    if (d->>'late')::int = 0 and (d->>'done_week')::int = 0 and (d->>'postponed_week')::int = 0 then continue; end if;
    insert into public.notifications (user_id, kind, title, body, link)
    select m, 'weekly_report', '📊 Weekly report — ' || w.name,
           (d->>'late') || ' late · ' || (d->>'done_week') || ' done this week · ' || (d->>'postponed_week') || ' postponed',
           '/w/' || w.id || '/report'
      from public.workspace_mudeers(w.id) m;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.run_weekly_followup_report(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ERPs: the same alerts inside the ERP's Task Hub page
-- ---------------------------------------------------------------------------
-- The ERP user's alerts about this workspace (newest 40).
create or replace function public.erp_alerts(p_key text, p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
begin
  if v_me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                                        'task_id', n.task_id, 'project_id', n.project_id,
                                        'read', n.read_at is not null, 'created_at', n.created_at)
           order by n.created_at desc)
      from (select n.* from public.notifications n
              left join public.projects p on p.id = n.project_id
             where n.user_id = v_me
               and (p.workspace_id = v_ws or n.link = '/w/' || v_ws || '/report')
             order by n.created_at desc limit 40) n), '[]'::jsonb);
end;
$$;
revoke all on function public.erp_alerts(text, text) from public;
grant execute on function public.erp_alerts(text, text) to anon, authenticated;

-- Mark alerts read: the given ids, or all of this workspace's when null.
create or replace function public.erp_alerts_read(p_key text, p_email text, p_ids uuid[])
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid := public.erp_workspace(p_key);
  v_me uuid := public.erp_user(p_email);
begin
  if v_me is null then return; end if;
  update public.notifications n set read_at = now()
   where n.user_id = v_me and n.read_at is null
     and (p_ids is null or n.id = any(p_ids))
     and (exists (select 1 from public.projects p where p.id = n.project_id and p.workspace_id = v_ws)
          or n.link = '/w/' || v_ws || '/report');
end;
$$;
revoke all on function public.erp_alerts_read(text, text, uuid[]) from public;
grant execute on function public.erp_alerts_read(text, text, uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule (09:00 Pakistan = 04:00 UTC; the report on Mondays)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.schedule('task-followups-daily', '0 4 * * *', 'select public.run_task_followups()');
select cron.schedule('task-followups-weekly', '5 4 * * 1', 'select public.run_weekly_followup_report()');
