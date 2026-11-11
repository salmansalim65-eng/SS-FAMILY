-- Project members from the dashboard: see who is in a project and, as its
-- owner, add workspace people, remove them, or make them owners — the same
-- rules as the Task Hub app's Members panel (can_manage_project; the last
-- owner stays, enforced by project_keep_an_owner). Adding someone by email
-- keeps using dashboard_project_share.

create or replace function public.dashboard_project_members(p_key text, p_project uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_ws uuid;
  v_out jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    select workspace_id into v_ws from public.projects where id = p_project;
    v_out := jsonb_build_object(
      'can_manage', public.can_manage_project(p_project),
      'me', v_me,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.email), 'email', pr.email,
                                            'role', pm.role, 'guest', wm.role = 'guest')
               order by pm.role = 'owner' desc, coalesce(nullif(pr.full_name, ''), pr.email))
          from public.project_members pm
          join public.profiles pr on pr.id = pm.user_id
          join public.workspace_members wm on wm.workspace_id = v_ws and wm.user_id = pm.user_id
         where pm.project_id = p_project), '[]'::jsonb),
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object('id', pr.id, 'name', coalesce(nullif(pr.full_name, ''), pr.email))
               order by coalesce(nullif(pr.full_name, ''), pr.email))
          from public.workspace_members wm
          join public.profiles pr on pr.id = wm.user_id
         where wm.workspace_id = v_ws and wm.role <> 'guest'
           and not exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = wm.user_id)), '[]'::jsonb));
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_out;
end;
$$;
revoke all on function public.dashboard_project_members(text, uuid) from public;
grant execute on function public.dashboard_project_members(text, uuid) to anon, authenticated;

-- p_action: 'add' (a workspace member), 'remove', 'owner', 'member'.
create or replace function public.dashboard_project_member_set(p_key text, p_project uuid, p_user uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_ws uuid;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    if not public.can_manage_project(p_project) then raise exception 'Only the project owner can change its members.'; end if;
    select workspace_id into v_ws from public.projects where id = p_project;
    if p_action = 'add' then
      if not exists (select 1 from public.workspace_members where workspace_id = v_ws and user_id = p_user and role <> 'guest') then
        raise exception 'That person is not in this workspace — add them by email instead.';
      end if;
      insert into public.project_members (project_id, user_id) values (p_project, p_user) on conflict do nothing;
    elsif p_action = 'remove' then
      delete from public.project_members where project_id = p_project and user_id = p_user;
      if not found then raise exception 'That person is not in this project.'; end if;
    elsif p_action in ('owner', 'member') then
      update public.project_members set role = p_action where project_id = p_project and user_id = p_user;
      if not found then raise exception 'That person is not in this project.'; end if;
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
revoke all on function public.dashboard_project_member_set(text, uuid, uuid, text) from public;
grant execute on function public.dashboard_project_member_set(text, uuid, uuid, text) to anon, authenticated;
