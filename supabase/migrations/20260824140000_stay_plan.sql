-- ============================================================================
-- SS-FAMILY :: the stay plan
--
-- A dinner guest needs a menu. A guest who moves in for a week needs a clean
-- room before they arrive, three meals a day while they are here, fresh
-- towels, their laundry done, a snack bar that does not run dry, and a room
-- reset after they go. That is a lot to hold in someone's head, so the app
-- holds it instead: adding a staying guest lays out the whole stay as tasks.
--
-- Templates are editable — every household is different — and generation is
-- idempotent, so changing an arrival date reshuffles the plan rather than
-- duplicating it.
-- ============================================================================
create table if not exists public.stay_plan_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  title       text not null,
  description text,
  phase       text not null check (phase in ('before','arrival','daily','periodic','departure','after')),
  -- before: days ahead of arrival · after: days past departure · else ignored
  offset_days integer not null default 0 check (offset_days between 0 and 30),
  -- periodic: repeat every N days of the stay
  every_days  integer not null default 1 check (every_days between 1 and 14),
  -- skip short visits: nobody does laundry for a one-night stay
  min_nights  integer not null default 0 check (min_nights between 0 and 30),
  priority    public.priority_level not null default 'medium',
  default_assignee uuid references public.users (id) on delete set null,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists stay_plan_touch on public.stay_plan_templates;
create trigger stay_plan_touch before update on public.stay_plan_templates
  for each row execute function public.touch_updated_at();

-- Which template made a task, so the plan can be recognised and rebuilt.
alter table public.tasks
  add column if not exists stay_plan_key text;

create unique index if not exists tasks_stay_plan_uniq
  on public.tasks (guest_id, stay_plan_key, due_date)
  where stay_plan_key is not null;

-- ---------------------------------------------------------------------------
-- Forty tasks must not mean forty notifications. Generation sets a flag; the
-- assignment notice stands down and one summary goes out instead.
-- ---------------------------------------------------------------------------
create or replace function public.trg_task_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('app.bulk_plan', true), '') = 'on' then
    return null;
  end if;

  if new.assigned_to is not null then
    perform public.fn_notify(
      array[new.assigned_to],
      'task_assigned',
      'New task: ' || new.title,
      format('You have been assigned "%s"%s. Priority: %s.',
             new.title,
             case when new.due_date is null then ''
                  else ' due ' || to_char(new.due_date, 'DD Mon YYYY') end,
             new.priority),
      'task', new.id, '/tasks'
    );
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Build (or rebuild) the plan for one stay.
--
-- Only pending tasks are ever removed, so a job somebody has already done is
-- never quietly undone by an edit to the dates.
-- ---------------------------------------------------------------------------
create or replace function public.generate_stay_plan(p_guest_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  g        record;
  t        record;
  v_nights integer;
  v_days   integer;
  v_due    date;
  v_made   integer := 0;
  v_step   integer;
  /** A six-month stay must not produce a thousand rows. */
  v_horizon constant integer := 30;
begin
  select * into g from public.guests where id = p_guest_id;
  if not found or g.guest_type <> 'staying' then
    return 0;
  end if;

  -- Departure unknown: lay out the welcome, and fill in the rest when the
  -- date is entered — this function runs again on every change.
  v_nights := greatest(coalesce(g.departure_date, g.arrival_date) - g.arrival_date, 0);
  v_days   := least(v_nights, v_horizon);

  perform set_config('app.bulk_plan', 'on', true);

  -- Clear the pending part of any earlier plan whose dates no longer fit.
  delete from public.tasks
   where guest_id = p_guest_id
     and stay_plan_key is not null
     and status = 'pending';

  for t in
    select * from public.stay_plan_templates
    where is_active and min_nights <= v_nights
    order by sort_order, key
  loop
    if t.phase = 'before' then
      v_due := g.arrival_date - t.offset_days;

    elsif t.phase = 'arrival' then
      v_due := g.arrival_date;

    elsif t.phase = 'departure' then
      v_due := coalesce(g.departure_date, g.arrival_date + v_nights);

    elsif t.phase = 'after' then
      v_due := coalesce(g.departure_date, g.arrival_date + v_nights) + t.offset_days;

    else
      -- Daily and periodic both walk the stay; only the stride differs. A
      -- periodic job starts one interval in, because the arrival-day version
      -- of it was already done during the preparation.
      v_step := case when t.phase = 'daily' then 1 else greatest(t.every_days, 1) end;
      v_due  := g.arrival_date + case when t.phase = 'daily' then 0 else v_step end;

      while v_due <= g.arrival_date + v_days loop
        insert into public.tasks
          (title, description, task_type, assigned_to, due_date, priority, status,
           guest_id, stay_plan_key, created_by)
        values (
          format('%s — %s', t.title, g.name),
          t.description, 'guest', t.default_assignee, v_due, t.priority, 'pending',
          p_guest_id, t.key, g.created_by
        )
        on conflict do nothing;

        if found then v_made := v_made + 1; end if;
        v_due := v_due + v_step;
      end loop;

      continue;   -- the loop above already inserted this template's rows
    end if;

    -- Nothing gains from a task that was already due yesterday.
    v_due := greatest(v_due, current_date);

    insert into public.tasks
      (title, description, task_type, assigned_to, due_date, priority, status,
       guest_id, stay_plan_key, created_by)
    values (
      format('%s — %s', t.title, g.name),
      t.description, 'guest', t.default_assignee, v_due, t.priority, 'pending',
      p_guest_id, t.key, g.created_by
    )
    on conflict do nothing;

    if found then v_made := v_made + 1; end if;
  end loop;

  perform set_config('app.bulk_plan', 'off', true);

  if v_made > 0 then
    perform public.fn_notify(
      public.fn_users_by_role('head', 'member'),
      'guest_added',
      format('Stay plan ready for %s', g.name),
      format('%s task(s) cover %s: the room before they arrive, meals and tidying '
             || 'each day, laundry and towels, and the reset after they leave.%s',
             v_made,
             case when v_nights > 0 then v_nights || ' night(s)' else 'their visit' end,
             case when (select count(*) from public.tasks
                         where guest_id = p_guest_id and stay_plan_key is not null
                           and assigned_to is null) > 0
                  then ' Some still need someone assigned.' else '' end),
      'guest', p_guest_id, '/tasks'
    );
  end if;

  return v_made;
end $$;

-- ---------------------------------------------------------------------------
-- Lay the plan out automatically: on arrival, and again whenever the dates,
-- the type or the name change.
-- ---------------------------------------------------------------------------
create or replace function public.trg_guest_stay_plan()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.guest_type = 'staying' then
      perform public.generate_stay_plan(new.id);
    end if;
    return null;
  end if;

  -- Turned into a dinner guest: the stay work no longer applies.
  if new.guest_type <> 'staying' then
    delete from public.tasks
     where guest_id = new.id and stay_plan_key is not null and status = 'pending';
    return null;
  end if;

  if new.arrival_date   is distinct from old.arrival_date
  or new.departure_date is distinct from old.departure_date
  or new.guest_type     is distinct from old.guest_type
  or new.name           is distinct from old.name then
    perform public.generate_stay_plan(new.id);
  end if;

  return null;
end $$;

drop trigger if exists guests_stay_plan on public.guests;
create trigger guests_stay_plan
  after insert or update on public.guests
  for each row execute function public.trg_guest_stay_plan();

-- A cancelled visit should not leave its chores behind.
create or replace function public.trg_guest_stay_plan_cleanup()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.tasks
   where guest_id = old.id and stay_plan_key is not null and status = 'pending';
  return old;
end $$;

drop trigger if exists guests_stay_plan_cleanup on public.guests;
create trigger guests_stay_plan_cleanup
  before delete on public.guests
  for each row execute function public.trg_guest_stay_plan_cleanup();

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.stay_plan_templates enable row level security;

drop policy if exists stay_plan_select on public.stay_plan_templates;
create policy stay_plan_select on public.stay_plan_templates
  for select to authenticated using (public.is_family());

drop policy if exists stay_plan_insert on public.stay_plan_templates;
create policy stay_plan_insert on public.stay_plan_templates
  for insert to authenticated with check (public.is_head());

drop policy if exists stay_plan_update on public.stay_plan_templates;
create policy stay_plan_update on public.stay_plan_templates
  for update to authenticated
  using (public.is_head()) with check (public.is_head());

drop policy if exists stay_plan_delete on public.stay_plan_templates;
create policy stay_plan_delete on public.stay_plan_templates
  for delete to authenticated using (public.is_head());

grant select, insert, update, delete on public.stay_plan_templates to authenticated;

revoke all on function public.generate_stay_plan(uuid) from public, anon, authenticated;
grant execute on function public.generate_stay_plan(uuid) to authenticated;
revoke all on function public.trg_guest_stay_plan() from public, anon, authenticated;
revoke all on function public.trg_guest_stay_plan_cleanup() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The default plan.
--
-- What a guest actually notices: a room that was ready before they walked in,
-- never having to ask for a towel or a bottle of water, their clothes coming
-- back folded, and somebody having already thought about breakfast. Everything
-- here is editable — turn off what does not fit, add what does.
-- ---------------------------------------------------------------------------
insert into public.stay_plan_templates
  (key, title, description, phase, offset_days, every_days, min_nights, priority, sort_order, is_active)
values
  -- ---------------------------------------------------------------- before
  ('confirm_arrival', 'Confirm arrival time and arrange pickup',
   'Call them, agree the time, and decide who collects them and from where.',
   'before', 3, 1, 0, 'high', 10, true),

  ('plan_meals', 'Plan the menu for their stay',
   'Ask what they like and what they cannot eat, then add the dishes on the Menu page.',
   'before', 2, 1, 0, 'medium', 20, true),

  ('deep_clean_room', 'Deep clean the guest room and bathroom',
   'Floors, windows, mirrors, wardrobe, under the bed. Air the room out.',
   'before', 2, 1, 0, 'high', 30, true),

  ('bed_linen', 'Fresh bed linen, pillows and blankets',
   'Clean sheets and pillowcases, a spare blanket in the wardrobe, extra pillows if there are children.',
   'before', 1, 1, 0, 'high', 40, true),

  ('towels_toiletries', 'Towels and toiletries in the guest bathroom',
   'Bath and hand towels per person, soap, shampoo, conditioner, toothbrush and toothpaste, comb, tissues, spare toilet paper, laundry basket.',
   'before', 1, 1, 0, 'high', 50, true),

  ('snack_bar', 'Stock the guest snack bar',
   'Bottled water, juice, dates, biscuits, fruit, nuts, and a kettle with tea, coffee and sugar.',
   'before', 1, 1, 0, 'medium', 60, true),

  ('room_check', 'Room check before they arrive',
   'AC and lights working, WiFi password written down, hangers in the wardrobe, iron and board, prayer mat and Qur''an, phone charger, waste basket, curtains closing properly.',
   'before', 1, 1, 0, 'medium', 70, true),

  -- --------------------------------------------------------------- arrival
  ('welcome_tray', 'Welcome tray: dates, qahwa and cold water',
   'Ready before they walk in, not after.',
   'arrival', 0, 1, 0, 'high', 80, true),

  ('settle_in', 'Show them the room, bathroom, WiFi and mealtimes',
   'Where everything is, when the family eats, and who to ask for anything.',
   'arrival', 0, 1, 0, 'medium', 90, true),

  -- ----------------------------------------------------------------- daily
  ('breakfast', 'Breakfast for the guests', 'Ask the night before what they would like.',
   'daily', 0, 1, 0, 'medium', 100, true),

  ('lunch', 'Lunch for the guests', null, 'daily', 0, 1, 0, 'medium', 110, true),

  ('dinner', 'Dinner for the guests', null, 'daily', 0, 1, 0, 'medium', 120, true),

  ('tidy_room', 'Tidy the guest room and make the beds',
   'While they are out of the room, not while they are sitting in it.',
   'daily', 0, 1, 0, 'medium', 130, true),

  ('refill_water', 'Refill drinking water and snacks',
   'Nobody should have to ask for a bottle of water.',
   'daily', 0, 1, 0, 'medium', 140, true),

  ('evening_tea', 'Evening tea and something sweet',
   'A pot of tea and something sweet in the evening — the part of the day guests remember.',
   'daily', 0, 1, 0, 'low', 150, true),

  -- -------------------------------------------------------------- periodic
  ('fresh_towels', 'Fresh towels for the guests', 'Swap them out; do not wait to be asked.',
   'periodic', 0, 2, 2, 'medium', 160, true),

  ('guest_laundry', 'Guest laundry: collect, wash, return folded',
   'Offer first — some guests would rather not. Return everything folded and ironed.',
   'periodic', 0, 3, 3, 'medium', 170, true),

  ('change_linen', 'Change the bed linen', null,
   'periodic', 0, 4, 4, 'medium', 180, true),

  -- ------------------------------------------------------------- departure
  ('journey_pack', 'Pack snacks and water for their journey',
   'Something to eat on the way, especially with children travelling.',
   'departure', 0, 1, 0, 'high', 190, true),

  ('forgotten_items', 'Check the room for forgotten items',
   'Chargers, wardrobe, under the bed, bathroom shelf, safe.',
   'departure', 0, 1, 0, 'high', 200, true),

  ('farewell_gift', 'Farewell gift', 'Dates, sweets, or something for the children.',
   'departure', 0, 1, 0, 'medium', 210, true),

  ('drop_off', 'Drop them to the airport or station',
   'Confirm the time the day before and leave early.',
   'departure', 0, 1, 0, 'high', 220, true),

  -- ----------------------------------------------------------------- after
  ('strip_beds', 'Strip the beds and wash all the linen', null,
   'after', 1, 1, 0, 'medium', 230, true),

  ('reset_room', 'Clean the guest room and bathroom, ready for next time',
   'Restock what ran out so the next visit starts from a full cupboard.',
   'after', 1, 1, 0, 'medium', 240, true)
on conflict (key) do nothing;

-- Lay out plans for the staying guests already on the books.
do $$
declare g record;
begin
  for g in select id from public.guests
            where guest_type = 'staying'
              and coalesce(departure_date, arrival_date) >= current_date
  loop
    perform public.generate_stay_plan(g.id);
  end loop;
end $$;
