-- A task can have a time on its due date (e.g. 15:30), so the calendar's
-- week view can place it in an hour slot. No time = an all-day task.
-- Functions are patched from their live bodies so nothing else changes.

alter table public.tasks add column if not exists due_time time;

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('dashboard_tasks', 'dashboard_task_update', 'task_hub_detail', 'erp_my_tasks', 'task_hub_apply')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    if r.proname = 'dashboard_tasks' then
      v_new := replace(v_new, '''due'', due_date, ', '''due'', due_date, ''time'', to_char(due_time, ''HH24:MI''), ');
    elsif r.proname = 'erp_my_tasks' then
      v_new := replace(v_new, '''due'', t.due_date, ', '''due'', t.due_date, ''time'', to_char(t.due_time, ''HH24:MI''), ');
    elsif r.proname = 'task_hub_detail' then
      v_new := replace(v_new, '''due'', t.due_date,', '''due'', t.due_date, ''time'', to_char(t.due_time, ''HH24:MI''),');
    elsif r.proname = 'dashboard_task_update' then
      v_new := replace(v_new, 'due_date = case when p_patch ? ''due'' then (p_patch->>''due'')::date else due_date end,',
                              'due_date = case when p_patch ? ''due'' then (p_patch->>''due'')::date else due_date end,
           due_time = case when p_patch ? ''time'' then nullif(p_patch->>''time'', '''')::time else due_time end,');
      v_new := replace(v_new, 'p_patch ? ''title'' or p_patch ? ''due'' or p_patch ? ''priority''', 'p_patch ? ''title'' or p_patch ? ''due'' or p_patch ? ''priority'' or p_patch ? ''time''');
    elsif r.proname = 'task_hub_apply' then
      v_new := replace(v_new, 'if p_op ? ''due'' then update public.tasks set due_date = nullif(p_op->>''due'', '''')::date where id = p_task; end if;',
                              'if p_op ? ''due'' then update public.tasks set due_date = nullif(p_op->>''due'', '''')::date where id = p_task; end if;
    if p_op ? ''time'' then update public.tasks set due_time = nullif(p_op->>''time'', '''')::time where id = p_task; end if;');
    end if;
    if v_new = v_def then raise exception 'Could not patch %', r.proname; end if;
    execute v_new;
  end loop;
end;
$$;
