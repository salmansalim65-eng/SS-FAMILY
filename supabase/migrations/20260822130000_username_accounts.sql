-- ============================================================================
-- SS-FAMILY :: username accounts, managed by the head of family
--
-- People sign in with a username, not an email. Supabase Auth still needs an
-- email internally, so each account gets a synthetic one:
--
--     <username>@ssfamily.local
--
-- Nobody ever sees or types it. The username is the identity in the UI, and
-- accounts are created only by the head of family through the `admin-users`
-- edge function — there is no public sign-up.
-- ============================================================================

alter table public.users add column if not exists username text;
alter table public.users add column if not exists relation text;

-- Backfill from the email local part so existing rows stay valid.
update public.users
   set username = split_part(email, '@', 1)
 where username is null;

create unique index if not exists users_username_uniq
  on public.users (lower(username));

alter table public.users alter column username set not null;

-- Derives the login email for a username. Kept in one place so the frontend,
-- the edge function and any manual SQL agree on the format.
create or replace function public.login_email(p_username text)
returns text
language sql immutable set search_path = public
as $$ select lower(btrim(p_username)) || '@ssfamily.local' $$;

revoke all on function public.login_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profiles are created only for accounts the head of family provisioned.
--
-- Supabase's signup endpoint stays reachable at the API level, so this is the
-- real gate: a self-registered account gets no profile row, which means
-- app_role() is null, is_family() is false, and every RLS policy denies it.
-- The account exists but can see and do nothing.
--
-- The one exception is the very first account, so a fresh database can be
-- bootstrapped without needing a service key.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role     public.user_role;
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_first    boolean := not exists (select 1 from public.users);
  v_username text;
begin
  if not v_first and coalesce(v_meta ->> 'created_by_admin', '') <> 'true' then
    return new;  -- self-registration: no profile, therefore no access
  end if;

  begin
    v_role := coalesce(nullif(v_meta ->> 'role', ''), 'member')::public.user_role;
  exception when others then
    v_role := 'member';
  end;

  if v_first then
    v_role := 'head';
  end if;

  v_username := lower(btrim(coalesce(
    nullif(v_meta ->> 'username', ''),
    split_part(new.email, '@', 1)
  )));

  insert into public.users (id, name, email, phone, whatsapp_number, role, username, relation)
  values (
    new.id,
    coalesce(nullif(v_meta ->> 'name', ''), v_username),
    new.email,
    nullif(v_meta ->> 'phone', ''),
    nullif(v_meta ->> 'whatsapp_number', ''),
    v_role,
    v_username,
    nullif(v_meta ->> 'relation', '')
  )
  on conflict (id) do nothing;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Nobody may change their own username: it is the login identity and is tied
-- to the synthetic auth email. Only the head can rename an account, and the
-- edge function keeps both sides in step.
-- ---------------------------------------------------------------------------
create or replace function public.guard_users()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role and not public.is_head() then
    raise exception 'Only the head of family can change roles';
  end if;
  if new.username is distinct from old.username then
    raise exception 'Usernames cannot be changed here';
  end if;
  if new.email is distinct from old.email then
    raise exception 'Login email is managed by the system';
  end if;
  if new.id is distinct from old.id then
    raise exception 'User id is immutable';
  end if;
  return new;
end $$;

-- The head of family needs to be able to remove an account's profile row.
drop policy if exists users_delete_head on public.users;
create policy users_delete_head on public.users
  for delete to authenticated using (public.is_head());
