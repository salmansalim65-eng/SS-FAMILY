-- ============================================================================
-- SS-FAMILY :: bootstrap the head-of-family account
--
-- People sign in with a USERNAME, not an email. Supabase Auth still needs an
-- email internally, so each account gets a synthetic one: <username>@ssfamily.local
--
-- This creates the single administrator account. Everyone else is added from
-- inside the app (Settings -> User management), which goes through the
-- `admin-users` edge function. There is no public sign-up.
--
--     username: ss
--     password: admin123      <-- change this immediately after first sign-in
-- ============================================================================

do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'ss@ssfamily.local';

  if v_id is null then
    v_id := gen_random_uuid();

    -- The token columns must be '' and never NULL: GoTrue scans them into Go
    -- `string` fields, and a NULL breaks every later sign-in with
    -- "converting NULL to string is unsupported".
    -- `phone` stays NULL on purpose - it carries a unique constraint.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new,
      email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated',
      'ss@ssfamily.local',
      crypt('admin123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', 'Head of Family', 'username', 'ss',
                         'role', 'head', 'relation', 'Head of Family',
                         'created_by_admin', 'true'),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_id::text, v_id,
      jsonb_build_object('sub', v_id::text, 'email', 'ss@ssfamily.local',
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  end if;

  insert into public.users (id, name, email, username, relation, role)
  values (v_id, 'Head of Family', 'ss@ssfamily.local', 'ss', 'Head of Family', 'head')
  on conflict (id) do update
    set name     = excluded.name,
        username = excluded.username,
        relation = excluded.relation,
        role     = excluded.role;
end $$;

-- Repair pass: fixes any account created before the NULL-token fix above,
-- so re-running this file is always safe.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;
