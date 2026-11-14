-- 20261113100000 removed the creator's automatic assignment by exact text,
-- which did not match the live bodies. Remove it by pattern from every path
-- that creates a task: the dashboard (direct and offline sync) and the ERPs.
-- pg_get_functiondef keeps SECURITY DEFINER and the pinned search_path.
do $$
declare f regprocedure; v_def text; v_new text;
begin
  foreach f in array array['dashboard_task_create(text,uuid,text,date,text)'::regprocedure,
                           'dashboard_sync_apply(text,jsonb)'::regprocedure,
                           'erp_task_create(text,text,uuid,text,date)'::regprocedure,
                           'erp_task_add(text,text,uuid,text,date,uuid[])'::regprocedure] loop
    v_def := pg_get_functiondef(f);
    v_new := regexp_replace(v_def, E'\\n[ \\t]*insert into public\\.task_assignees \\(task_id, user_id, assigned_by\\) values \\(v_id, v_me, v_me\\);[ \\t\\r]*', '', 'g');
    v_new := regexp_replace(v_new, E'\\n[ \\t]*if cardinality\\(v_people\\) = 0 then v_people := array\\[v_me\\]; end if;[ \\t\\r]*', '', 'g');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end $$;
