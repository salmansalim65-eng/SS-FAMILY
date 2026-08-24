-- ============================================================================
-- SS-FAMILY :: two kinds of guest
--
--   staying  sleeps in the house  → all-day calendar event across the stay,
--                                   reminder 3 days before arrival
--   dinner   invited for a meal   → timed evening event on one date,
--                                   reminder 1 day before
-- ============================================================================

alter table public.guests
  add column if not exists guest_type text not null default 'staying'
    check (guest_type in ('staying', 'dinner'));

alter table public.guests
  add column if not exists event_time time;

create index if not exists guests_type_idx on public.guests (guest_type, arrival_date);

-- ---------------------------------------------------------------------------
-- Keep the two shapes honest regardless of who writes the row. The form
-- already clears these, but a direct API call could otherwise store a dinner
-- guest with a departure date and a room, which would produce an all-day
-- event spanning days instead of a timed evening one.
-- ---------------------------------------------------------------------------
create or replace function public.normalise_guest()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.guest_type = 'dinner' then
    new.departure_date := null;
    new.room           := null;
    new.origin_city    := null;
    new.event_time     := coalesce(new.event_time, time '20:00');
  else
    new.event_time     := null;
  end if;
  return new;
end $$;

drop trigger if exists guests_normalise on public.guests;
create trigger guests_normalise
  before insert or update on public.guests
  for each row execute function public.normalise_guest();

update public.guests
   set departure_date = null, room = null, origin_city = null,
       event_time = coalesce(event_time, time '20:00')
 where guest_type = 'dinner';

update public.guests set event_time = null where guest_type = 'staying';

-- ---------------------------------------------------------------------------
-- Dashboard counts: head-count means people sleeping in the house, so dinner
-- guests are excluded from it but still counted as upcoming.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'upcoming_guests',   (select count(*) from public.guests
                           where arrival_date between current_date and current_date + 7),
    'upcoming_staying',  (select count(*) from public.guests
                           where guest_type = 'staying'
                             and arrival_date between current_date and current_date + 7),
    'upcoming_dinners',  (select count(*) from public.guests
                           where guest_type = 'dinner'
                             and arrival_date between current_date and current_date + 7),
    'total_guest_heads', (select coalesce(sum(total_guests), 0) from public.guests
                           where guest_type = 'staying'
                             and (departure_date is null or departure_date >= current_date)
                             and arrival_date <= current_date + 30),
    'menu_draft',        (select count(*) from public.menu_items where status = 'draft'),
    'menu_approved',     (select count(*) from public.menu_items
                           where status in ('approved','in_progress')),
    'menu_cost',         (select coalesce(sum(cost), 0) from public.menu_items
                           where status <> 'rejected'),
    'tasks_pending',     (select count(*) from public.tasks where status <> 'completed'),
    'tasks_overdue',     (select count(*) from public.tasks
                           where status <> 'completed' and due_date < current_date),
    'tasks_due_soon',    (select count(*) from public.tasks
                           where status <> 'completed'
                             and due_date between current_date and current_date + 2),
    'shopping_pending',  (select count(*) from public.shopping_consolidated
                           where status = 'pending'),
    'unread_notifications', (select count(*) from public.notifications
                              where user_id = auth.uid() and read_at is null)
  );
$$;

-- ---------------------------------------------------------------------------
-- Notification wording follows the kind of visit.
-- ---------------------------------------------------------------------------
create or replace function public.trg_guest_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_days integer;
begin
  v_days := new.arrival_date - current_date;

  if new.guest_type = 'dinner' then
    perform public.fn_notify(
      public.fn_users_by_role('head', 'member'),
      'guest_added',
      'Dinner guest: ' || new.name,
      format('%s (%s) joining for dinner on %s%s - %s guest(s), %s male, %s female.%s',
             new.name, coalesce(new.relationship, 'guest'),
             to_char(new.arrival_date, 'DD Mon YYYY'),
             case when new.event_time is null then ''
                  else ' at ' || to_char(new.event_time, 'HH12:MI AM') end,
             new.male_count + new.female_count, new.male_count, new.female_count,
             case when v_days between 0 and 7
                  then ' That is in ' || v_days || ' day(s)!' else '' end),
      'guest', new.id, '/guests'
    );
  else
    perform public.fn_notify(
      public.fn_users_by_role('head', 'member'),
      'guest_added',
      'New guest: ' || new.name,
      format('%s (%s) arriving %s with %s guest(s) - %s male, %s female.%s',
             new.name, coalesce(new.relationship, 'guest'),
             to_char(new.arrival_date, 'DD Mon YYYY'),
             new.male_count + new.female_count, new.male_count, new.female_count,
             case when v_days between 0 and 7
                  then ' Arriving in ' || v_days || ' day(s)!' else '' end),
      'guest', new.id, '/guests'
    );
  end if;

  return null;
end $$;
