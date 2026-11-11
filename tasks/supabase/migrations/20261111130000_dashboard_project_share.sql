-- "Share" a project from the dashboard panel by email: someone already in SS
-- Tasks is added to the project (as a workspace guest if not a member);
-- anyone else gets a guest invite link to it. Needs owner/admin.
create or replace function public.dashboard_project_share(p_key text, p_project uuid, p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.home_dashboard_owner();
  v_claims text := current_setting('request.jwt.claims', true);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ws uuid;
  v_user uuid;
  v_name text;
  v_token text;
  v_result jsonb;
begin
  perform public.home_dashboard_check(p_key);
  if v_me is null then raise exception 'Owner has no SS Tasks account yet.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  begin
    if not public.can_see_project(p_project) then raise exception 'Project not found.'; end if;
    select workspace_id into v_ws from public.projects where id = p_project;
    if not public.is_ws_admin(v_ws) then raise exception 'Only an owner or admin of this workspace can share it.'; end if;
    select id, coalesce(nullif(full_name, ''), email) into v_user, v_name from public.profiles where lower(email) = v_email;
    if v_user is not null then
      insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, v_user, 'guest') on conflict do nothing;
      insert into public.project_members (project_id, user_id) values (p_project, v_user) on conflict do nothing;
      v_result := jsonb_build_object('status', 'added', 'name', v_name);
    else
      select token into v_token from public.invitations
       where email = v_email and project_id = p_project and accepted_at is null and expires_at > now()
       order by created_at desc limit 1;
      if v_token is null then
        insert into public.invitations (project_id, email, role, invited_by) values (p_project, v_email, 'guest', v_me) returning token into v_token;
      end if;
      v_result := jsonb_build_object('status', 'invited', 'email', v_email, 'token', v_token);
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_result;
end;
$$;
revoke all on function public.dashboard_project_share(text, uuid, text) from public;
grant execute on function public.dashboard_project_share(text, uuid, text) to anon, authenticated;
