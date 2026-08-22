-- ============================================================================
-- SS-FAMILY :: demo accounts + sample data
--
-- Every demo account uses the password:  Family@123
-- Change or remove these before using the system for real.
--
-- WhatsApp numbers are intentionally left blank so the seed never queues a
-- message to a number that isn't yours. Fill them in from Settings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Demo accounts
-- ---------------------------------------------------------------------------
do $$
declare
  v_people jsonb := '[
    {"email":"head@ssfamily.app",   "name":"Salman Salim", "role":"head",   "phone":"+966500000001"},
    {"email":"fatima@ssfamily.app", "name":"Fatima",       "role":"member", "phone":"+966500000002"},
    {"email":"ahmed@ssfamily.app",  "name":"Ahmed",        "role":"member", "phone":"+966500000003"},
    {"email":"hassan@ssfamily.app", "name":"Hassan",       "role":"member", "phone":"+966500000004"},
    {"email":"driver@ssfamily.app", "name":"Kamal (Driver)","role":"driver","phone":"+966500000005"}
  ]'::jsonb;
  v_person jsonb;
  v_id     uuid;
begin
  for v_person in select * from jsonb_array_elements(v_people) loop
    select id into v_id from auth.users where email = v_person ->> 'email';

    if v_id is null then
      v_id := gen_random_uuid();

      -- The token columns must be '' and never NULL. GoTrue scans them into
      -- Go `string` fields, so a NULL makes every later sign-in fail with
      -- "converting NULL to string is unsupported" (surfaced in the browser
      -- as "Database error querying schema").
      -- `phone` is deliberately left NULL: it carries a unique constraint,
      -- so blanking it would collide across accounts.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new,
        email_change, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_id,
        'authenticated',
        'authenticated',
        v_person ->> 'email',
        crypt('Family@123', gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'name',  v_person ->> 'name',
          'role',  v_person ->> 'role',
          'phone', v_person ->> 'phone'
        ),
        now(), now(),
        '', '', '', '', '', '', '', ''
      );

      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        v_id::text,
        v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_person ->> 'email',
                           'email_verified', true, 'phone_verified', false),
        'email',
        now(), now(), now()
      );
    end if;

    -- handle_new_user() forces the very first account to 'head'; restate the
    -- intended role explicitly so the seed is order independent.
    update public.users
       set name  = v_person ->> 'name',
           role  = (v_person ->> 'role')::public.user_role,
           phone = v_person ->> 'phone'
     where id = v_id;
  end loop;
end $$;

-- Repair pass: makes the seed self-healing for any account that was created
-- before the fix above, so re-running it is always safe.
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

-- ---------------------------------------------------------------------------
-- Sample data.  Runs only on a still-empty system so the seed is re-runnable.
-- ---------------------------------------------------------------------------
do $$
declare
  v_head    uuid;
  v_fatima  uuid;
  v_ahmed   uuid;
  v_hassan  uuid;
  v_guest1  uuid;
  v_guest2  uuid;
  v_menu_karahi uuid;
  v_menu_kebab  uuid;
begin
  if exists (select 1 from public.guests) then
    raise notice 'Sample data already present, skipping.';
    return;
  end if;

  select id into v_head   from public.users where email = 'head@ssfamily.app';
  select id into v_fatima from public.users where email = 'fatima@ssfamily.app';
  select id into v_ahmed  from public.users where email = 'ahmed@ssfamily.app';
  select id into v_hassan from public.users where email = 'hassan@ssfamily.app';

  -- WORKFLOW 1 :: guests -----------------------------------------------------
  insert into public.guests
    (name, arrival_date, departure_date, male_count, female_count,
     relationship, room, special_needs, origin_city, created_by)
  values
    ('Ali Ahmed Family', current_date + 3, current_date + 17, 5, 2,
     'Cousin', 'Guest Room 1 + Majlis', 'One elderly guest - no spicy food, ground floor room preferred',
     'Lahore, Pakistan', v_head)
  returning id into v_guest1;

  insert into public.guests
    (name, arrival_date, departure_date, male_count, female_count,
     relationship, room, special_needs, origin_city, created_by)
  values
    ('Uncle Riaz & Aunt Nasreen', current_date + 12, current_date + 26, 1, 1,
     'Uncle', 'Guest Room 2', 'Diabetic - sugar free desserts',
     'Islamabad, Pakistan', v_head)
  returning id into v_guest2;

  -- WORKFLOW 2 :: menu suggestions ------------------------------------------
  -- left as DRAFT, waiting for the head of family
  insert into public.menu_items
    (dish_name, meal_type, serve_date, guest_id, suggested_by, status,
     cook_person, homemade_or_outside, quantity, unit, cost, notes)
  values
    ('Chicken Biryani', 'dinner', current_date + 3, v_guest1, v_fatima, 'draft',
     v_fatima, 'homemade', 8, 'kg', 220.00, 'Welcome dinner on arrival night'),
    ('Seekh Kebab Platter', 'dinner', current_date + 3, v_guest1, v_ahmed, 'draft',
     null, 'outside', 4, 'kg', 320.00, 'Order from Al Romansiah');

  -- suggested then approved, so the approval trigger creates the task
  insert into public.menu_items
    (dish_name, meal_type, serve_date, guest_id, suggested_by, status,
     cook_person, homemade_or_outside, quantity, unit, cost, notes)
  values
    ('Chicken Karahi', 'lunch', current_date + 4, v_guest1, v_fatima, 'draft',
     v_fatima, 'homemade', 3, 'kg', 150.00, 'Medium spice - elderly guest')
  returning id into v_menu_karahi;

  insert into public.menu_items
    (dish_name, meal_type, serve_date, guest_id, suggested_by, status,
     cook_person, homemade_or_outside, outside_responsible, quantity, unit, cost, notes)
  values
    ('Mutton Haleem', 'dinner', current_date + 5, v_guest1, v_hassan, 'draft',
     null, 'outside', v_hassan, 2, 'kg', 180.00, 'Pick up before Maghrib')
  returning id into v_menu_kebab;

  update public.menu_items
     set status = 'approved', approved_by = v_head
   where id in (v_menu_karahi, v_menu_kebab);

  -- WORKFLOW 3 :: household tasks -------------------------------------------
  insert into public.tasks
    (title, description, task_type, assigned_to, due_date, priority, status, guest_id, created_by)
  values
    ('Prepare Guest Room 1',
     'Fresh bedding, towels, clear the wardrobe, check the AC.',
     'household', v_ahmed, current_date + 2, 'high', 'pending', v_guest1, v_head),
    ('Arrange airport pickup',
     'Two cars needed - 7 guests plus luggage. Confirm flight number the day before.',
     'guest', v_hassan, current_date + 2, 'high', 'pending', v_guest1, v_head),
    ('Service the second AC unit',
     'Majlis AC is not cooling well. Call the technician.',
     'household', v_ahmed, current_date + 1, 'medium', 'in_progress', null, v_head);

  -- WORKFLOW 4 :: shopping, including the duplicate from the spec example ----
  insert into public.shopping_list
    (item_name, quantity, unit, category, added_by, priority, guest_id, notes)
  values
    ('Basmati Rice',  2, 'kg',   'Grains',     v_fatima, 'high',   v_guest1, 'Sella, for the biryani'),
    ('Chicken',       1, 'kg',   'Meat',       v_ahmed,  'high',   v_guest1, null),
    ('Chicken',       2, 'kg',   'Meat',       v_hassan, 'medium', v_guest1, 'Fresh, not frozen'),
    ('Tomatoes',      3, 'kg',   'Vegetables', v_fatima, 'medium', null,     null),
    ('Onions',        5, 'kg',   'Vegetables', v_fatima, 'medium', null,     null),
    ('Yoghurt',       2, 'kg',   'Dairy',      v_ahmed,  'medium', null,     'For the karahi and raita'),
    ('Fresh Mint',    4, 'bunch','Vegetables', v_hassan, 'low',    null,     null),
    ('Sugar Free Sweetener', 1, 'pack', 'Other', v_head, 'low',    v_guest2, 'For Uncle Riaz'),
    ('Bottled Water', 6, 'carton','Beverages', v_head,   'high',   v_guest1, '330ml bottles');
end $$;
