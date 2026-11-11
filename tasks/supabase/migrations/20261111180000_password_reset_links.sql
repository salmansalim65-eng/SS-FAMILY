-- Forgotten passwords, without email: a workspace owner makes a one-time
-- reset link for someone in their workspace (like invite links) and sends it
-- on WhatsApp. Opening it lets that person choose a new password.
--  * Only a workspace OWNER can make one, only for someone in that workspace,
--    and never for anyone who is an owner or admin of any workspace (so no
--    one can take over a manager's account).
--  * A link works once, for 1 hour. Using it signs the person out everywhere.

create table if not exists public.password_resets (
  token text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  used_at timestamptz
);
alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon, authenticated;

create or replace function public.create_password_reset(p_user uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_user = auth.uid() then raise exception 'Change your own password from your profile.'; end if;
  if not exists (
    select 1 from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id and theirs.user_id = p_user
     where mine.user_id = auth.uid() and mine.role = 'owner'
  ) then raise exception 'Only the owner of a workspace this person is in can reset their password.'; end if;
  if exists (select 1 from public.workspace_members where user_id = p_user and role in ('owner', 'admin')) then
    raise exception 'Owners and admins reset their own password.';
  end if;
  update public.password_resets set used_at = now() where user_id = p_user and used_at is null;  -- one live link at a time
  insert into public.password_resets (user_id, created_by) values (p_user, auth.uid()) returning token into v_token;
  return v_token;
end;
$$;
revoke all on function public.create_password_reset(uuid) from public, anon;
grant execute on function public.create_password_reset(uuid) to authenticated;

-- For the reset page: whose link this is, while it is still usable.
create or replace function public.password_reset_info(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', p.email, 'name', p.full_name)
    from public.password_resets r join public.profiles p on p.id = r.user_id
   where r.token = p_token and r.used_at is null and r.expires_at > now();
$$;
revoke all on function public.password_reset_info(text) from public;
grant execute on function public.password_reset_info(text) to anon, authenticated;

create or replace function public.reset_password_with_token(p_token text, p_password text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare r public.password_resets;
begin
  select * into r from public.password_resets where token = p_token for update;
  if not found or r.used_at is not null or r.expires_at < now() then
    raise exception 'This reset link is not valid any more. Ask for a new one.';
  end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Use at least 8 characters.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = r.user_id;
  delete from auth.refresh_tokens where user_id::uuid = r.user_id;
  delete from auth.sessions where user_id = r.user_id;
  update public.password_resets set used_at = now() where token = p_token;
  return (select email from public.profiles where id = r.user_id);
end;
$$;
revoke all on function public.reset_password_with_token(text, text) from public;
grant execute on function public.reset_password_with_token(text, text) to anon, authenticated;
