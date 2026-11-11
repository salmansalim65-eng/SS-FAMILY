-- Columns (buckets) from the dashboard's project board: add, rename, move
-- left/right, delete an empty one. Project owners only (can_manage_project).
-- p_action: 'add' {p_name}, 'rename' {p_bucket, p_name}, 'left' / 'right' {p_bucket},
--           'delete' {p_bucket} (refused while it holds tasks, or if it is the last column).

create or replace function public.dashboard_bucket_edit(p_key text, p_project uuid, p_action text, p_bucket uuid, p_name text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_name text := left(trim(coalesce(p_name, '')), 80);
  v_pos double precision;
  v_other uuid;
  v_other_pos double precision;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    if not public.can_manage_project(p_project) then raise exception 'Only the project owner can change its columns.'; end if;
    if p_action <> 'add' and not exists (select 1 from public.buckets where id = p_bucket and project_id = p_project) then
      raise exception 'That column is not in this project.';
    end if;

    if p_action = 'add' then
      if v_name = '' then raise exception 'Give the column a name.'; end if;
      insert into public.buckets (project_id, name, position)
      values (p_project, v_name, coalesce((select max(position) from public.buckets where project_id = p_project), 0) + 1);
    elsif p_action = 'rename' then
      if v_name = '' then raise exception 'Give the column a name.'; end if;
      update public.buckets set name = v_name where id = p_bucket;
    elsif p_action in ('left', 'right') then
      select position into v_pos from public.buckets where id = p_bucket;
      if p_action = 'left' then
        select id, position into v_other, v_other_pos from public.buckets
         where project_id = p_project and position < v_pos order by position desc limit 1;
      else
        select id, position into v_other, v_other_pos from public.buckets
         where project_id = p_project and position > v_pos order by position limit 1;
      end if;
      if v_other is not null then
        update public.buckets set position = v_other_pos where id = p_bucket;
        update public.buckets set position = v_pos where id = v_other;
      end if;
    elsif p_action = 'delete' then
      if exists (select 1 from public.tasks where bucket_id = p_bucket) then
        raise exception 'Move or delete this column''s tasks first (completed ones too).';
      end if;
      if (select count(*) from public.buckets where project_id = p_project) <= 1 then
        raise exception 'A project needs at least one column.';
      end if;
      delete from public.buckets where id = p_bucket;
    else
      raise exception 'Unknown change.';
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_bucket_edit(text, uuid, text, uuid, text) from public;
grant execute on function public.dashboard_bucket_edit(text, uuid, text, uuid, text) to anon, authenticated;
