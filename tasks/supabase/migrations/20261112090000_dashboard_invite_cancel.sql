-- Cancel an invite link from the dashboard (Share panel / project Members),
-- and list a project's pending invites in its Members panel.
-- Allowed for the invite's sender, the project's owners, or (for a
-- workspace invite) the workspace's owners/admins.

create or replace function public.dashboard_invite_cancel(p_key text, p_token text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_inv public.invitations;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no Task Hub account yet.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    select * into v_inv from public.invitations where token = p_token;
    if v_inv.id is null then raise exception 'That invite is already gone.'; end if;
    if v_inv.accepted_at is not null then raise exception 'That invite was already used — remove the person from the project instead.'; end if;
    if not (v_inv.invited_by = v_me
            or (v_inv.project_id is not null and public.can_manage_project(v_inv.project_id))
            or (v_inv.workspace_id is not null and public.is_ws_admin(v_inv.workspace_id))) then
      raise exception 'Only the person who sent it or the project owner can cancel this invite.';
    end if;
    delete from public.invitations where id = v_inv.id;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
end;
$$;
revoke all on function public.dashboard_invite_cancel(text, text) from public;
grant execute on function public.dashboard_invite_cancel(text, text) to anon, authenticated;

-- dashboard_project_members also returns the pending invites.
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
           and not exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = wm.user_id)), '[]'::jsonb),
      'invites', coalesce((
        select jsonb_agg(jsonb_build_object('token', i.token, 'email', i.email, 'created_at', i.created_at) order by i.created_at desc)
          from public.invitations i
         where i.project_id = p_project and i.accepted_at is null and i.expires_at > now()), '[]'::jsonb));
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
