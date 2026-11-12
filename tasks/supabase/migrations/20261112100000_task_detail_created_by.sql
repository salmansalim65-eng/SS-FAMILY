-- The task panel shows who made a task and when: task_hub_detail (used by
-- dashboard_task_detail and erp_task_detail) returns
--   'created_by' {id, name} and 'created_at'.
-- Patched from the live body so nothing else in it changes.

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.task_hub_detail(uuid)'::regprocedure);
  if v_def like '%''created_by''%' then return; end if;  -- already there
  v_new := replace(v_def, '''can_delete'',',
    '''created_by'', (select jsonb_build_object(''id'', pr.id, ''name'', coalesce(nullif(pr.full_name, ''''), pr.email, ''Someone''))
                      from public.profiles pr where pr.id = t.created_by),
    ''created_at'', t.created_at,
    ''can_delete'',');
  if v_new = v_def then raise exception 'Could not patch task_hub_detail'; end if;
  execute v_new;
end;
$$;
