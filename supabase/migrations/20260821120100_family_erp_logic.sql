-- ============================================================================
-- SS-FAMILY :: business logic
-- Helper functions, workflow triggers, consolidation view, dashboard RPCs
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Role helpers.  SECURITY DEFINER so that RLS policies on `users` can call
-- them without recursing back into their own policy.
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() $$;

create or replace function public.is_head()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() = 'head', false) $$;

create or replace function public.is_family()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() in ('head','member'), false) $$;

create or replace function public.is_driver()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.app_role() = 'driver', false) $$;

-- ---------------------------------------------------------------------------
-- updated_at housekeeping
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger guests_touch        before update on public.guests
  for each row execute function public.touch_updated_at();
create trigger menu_items_touch    before update on public.menu_items
  for each row execute function public.touch_updated_at();
create trigger tasks_touch         before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger shopping_list_touch before update on public.shopping_list
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Notification fan-out.  A row is queued for WhatsApp only when the recipient
-- actually has a WhatsApp number on file; the edge function drains the queue.
-- ---------------------------------------------------------------------------
create or replace function public.fn_notify(
  p_users       uuid[],
  p_type        text,
  p_title       text,
  p_message     text,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_link        text default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  insert into public.notifications
    (user_id, type, title, message, entity_type, entity_id, link, sent_via, whatsapp_status)
  select distinct u.id, p_type, p_title, p_message, p_entity_type, p_entity_id, p_link,
         case when coalesce(u.whatsapp_number, '') = '' then array['in_app']
              else array['in_app','whatsapp'] end,
         case when coalesce(u.whatsapp_number, '') = '' then 'not_sent' else 'queued' end
  from public.users u
  where u.id = any(p_users)
    and u.is_active
    and u.id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Recipient sets -------------------------------------------------------------
create or replace function public.fn_users_by_role(variadic p_roles public.user_role[])
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.users where role = any(p_roles) and is_active
$$;

-- ---------------------------------------------------------------------------
-- Generic activity log trigger.
--   TG_ARGV[0] = column holding the human-readable label
--   TG_ARGV[1] = optional status column, recorded in `details`
-- ---------------------------------------------------------------------------
create or replace function public.trg_activity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_label   text;
  v_old     text;
  v_new     text;
  v_actor   public.users%rowtype;
  v_id      uuid;
  v_details jsonb := '{}'::jsonb;
begin
  select * into v_actor from public.users where id = auth.uid();

  if tg_op = 'DELETE' then
    v_id := old.id;
    execute format('select ($1).%I::text', tg_argv[0]) into v_label using old;
  else
    v_id := new.id;
    execute format('select ($1).%I::text', tg_argv[0]) into v_label using new;
  end if;

  if tg_nargs > 1 then
    if tg_op <> 'INSERT' then
      execute format('select ($1).%I::text', tg_argv[1]) into v_old using old;
    end if;
    if tg_op <> 'DELETE' then
      execute format('select ($1).%I::text', tg_argv[1]) into v_new using new;
    end if;
    v_details := jsonb_build_object('from', v_old, 'to', v_new);
  end if;

  -- an UPDATE that did not move the tracked status is not worth logging
  if tg_op = 'UPDATE' and tg_nargs > 1 and v_old is not distinct from v_new then
    return null;
  end if;

  insert into public.activity_log
    (actor_id, actor_name, action, entity_type, entity_id, entity_label, details)
  values (
    v_actor.id,
    coalesce(v_actor.name, 'System'),
    lower(tg_op) || '_' || tg_argv[2],
    tg_argv[2],
    v_id,
    v_label,
    v_details
  );
  return null;
end $$;

create trigger guests_activity after insert or update or delete on public.guests
  for each row execute function public.trg_activity('name', 'room', 'guest');
create trigger menu_activity after insert or update or delete on public.menu_items
  for each row execute function public.trg_activity('dish_name', 'status', 'menu_item');
create trigger tasks_activity after insert or update or delete on public.tasks
  for each row execute function public.trg_activity('title', 'status', 'task');
create trigger shopping_activity after insert or update or delete on public.shopping_list
  for each row execute function public.trg_activity('item_name', 'status', 'shopping_item');

-- ---------------------------------------------------------------------------
-- WORKFLOW 1 :: a guest is added -> the whole family hears about it
-- ---------------------------------------------------------------------------
create or replace function public.trg_guest_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_days integer;
begin
  v_days := new.arrival_date - current_date;
  perform public.fn_notify(
    public.fn_users_by_role('head', 'member'),
    'guest_added',
    'New guest: ' || new.name,
    format('%s (%s) arriving %s with %s guest(s) - %s male, %s female.%s',
           new.name,
           coalesce(new.relationship, 'guest'),
           to_char(new.arrival_date, 'DD Mon YYYY'),
           new.male_count + new.female_count,
           new.male_count,
           new.female_count,
           case when v_days between 0 and 7
                then ' Arriving in ' || v_days || ' day(s)!'
                else '' end),
    'guest', new.id, '/guests'
  );
  return null;
end $$;

create trigger guests_notify after insert on public.guests
  for each row execute function public.trg_guest_created();

-- ---------------------------------------------------------------------------
-- WORKFLOW 2 :: menu suggestion -> approval -> automatic task creation
-- ---------------------------------------------------------------------------
create or replace function public.trg_menu_suggested()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_who text;
begin
  select name into v_who from public.users where id = new.suggested_by;
  if new.status = 'draft' then
    perform public.fn_notify(
      public.fn_users_by_role('head'),
      'menu_suggested',
      'Menu suggestion: ' || new.dish_name,
      format('%s suggested "%s" for %s. Awaiting your approval.',
             coalesce(v_who, 'A family member'), new.dish_name,
             coalesce(to_char(new.serve_date, 'DD Mon'), 'an upcoming meal')),
      'menu_item', new.id, '/menu'
    );
  end if;
  return null;
end $$;

create trigger menu_notify_suggested after insert on public.menu_items
  for each row execute function public.trg_menu_suggested();

create or replace function public.trg_menu_approved()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_assignee uuid;
  v_title    text;
  v_due      date;
  v_name     text;
begin
  -- ---- approval transition -------------------------------------------------
  if new.status = 'approved' and old.status is distinct from 'approved' then

    v_assignee := case
      when new.homemade_or_outside = 'outside'
        then coalesce(new.outside_responsible, new.cook_person, new.suggested_by)
      else coalesce(new.cook_person, new.suggested_by)
    end;

    v_title := case when new.homemade_or_outside = 'outside'
                    then 'Buy ' || new.dish_name
                    else 'Cook ' || new.dish_name end;

    v_due := coalesce(new.serve_date, current_date);

    if not exists (select 1 from public.tasks where menu_item_id = new.id) then
      insert into public.tasks
        (title, description, task_type, assigned_to, due_date, priority, status,
         menu_item_id, guest_id, created_by)
      values (
        v_title,
        format('Approved menu item. Quantity: %s %s. Estimated cost: SAR %s.%s',
               trim(to_char(new.quantity, 'FM999999990.99')),
               coalesce(new.unit, 'serving'),
               trim(to_char(new.cost, 'FM999999990.00')),
               case when new.notes is null or new.notes = '' then ''
                    else ' Notes: ' || new.notes end),
        'menu',
        v_assignee,
        v_due,
        case when v_due - current_date <= 1 then 'high'::public.priority_level
             else 'medium'::public.priority_level end,
        'pending',
        new.id,
        new.guest_id,
        new.approved_by
      );
    end if;

    select name into v_name from public.users where id = new.approved_by;

    perform public.fn_notify(
      array_remove(array[new.suggested_by, new.cook_person, new.outside_responsible], null)
        || public.fn_users_by_role('head'),
      'menu_approved',
      'Menu approved: ' || new.dish_name,
      format('"%s" was approved by %s. A task has been created and assigned.',
             new.dish_name, coalesce(v_name, 'the head of family')),
      'menu_item', new.id, '/menu'
    );

  -- ---- any other meaningful edit of an already-approved item ---------------
  elsif old.status = 'approved' and (
        new.dish_name           is distinct from old.dish_name or
        new.serve_date          is distinct from old.serve_date or
        new.quantity            is distinct from old.quantity or
        new.cook_person         is distinct from old.cook_person or
        new.homemade_or_outside is distinct from old.homemade_or_outside) then

    perform public.fn_notify(
      array_remove(array[new.suggested_by, new.cook_person, new.outside_responsible], null)
        || public.fn_users_by_role('head'),
      'menu_changed',
      'Menu changed: ' || new.dish_name,
      format('"%s" was updated. Please re-check the details.', new.dish_name),
      'menu_item', new.id, '/menu'
    );
  end if;

  -- keep the generated task's due date in step with the serve date
  if new.serve_date is distinct from old.serve_date then
    update public.tasks set due_date = new.serve_date
     where menu_item_id = new.id and status <> 'completed';
  end if;

  return null;
end $$;

create trigger menu_notify_approved after update on public.menu_items
  for each row execute function public.trg_menu_approved();

-- Stamp the approver date automatically
create or replace function public.trg_menu_stamp()
returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approver_date := now();
    new.approved_by   := coalesce(new.approved_by, auth.uid());
  end if;
  return new;
end $$;

create trigger menu_stamp before update on public.menu_items
  for each row execute function public.trg_menu_stamp();

-- ---------------------------------------------------------------------------
-- WORKFLOW 3 :: task assignment / completion notifications
-- ---------------------------------------------------------------------------
create or replace function public.trg_task_assigned()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
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

create trigger tasks_notify_insert after insert on public.tasks
  for each row execute function public.trg_task_assigned();

create or replace function public.trg_task_updated()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_who text;
begin
  -- re-assignment
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    perform public.fn_notify(
      array[new.assigned_to],
      'task_assigned',
      'Task assigned to you: ' || new.title,
      format('"%s" is now yours%s.', new.title,
             case when new.due_date is null then ''
                  else ', due ' || to_char(new.due_date, 'DD Mon YYYY') end),
      'task', new.id, '/tasks'
    );
  end if;

  -- completion
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select name into v_who from public.users where id = new.assigned_to;
    perform public.fn_notify(
      array_remove(array[new.created_by], null) || public.fn_users_by_role('head'),
      'task_completed',
      'Task completed: ' || new.title,
      format('%s marked "%s" as completed.', coalesce(v_who, 'Someone'), new.title),
      'task', new.id, '/tasks'
    );

    -- an approved menu item follows its task through to completion
    if new.menu_item_id is not null then
      update public.menu_items set status = 'completed'
       where id = new.menu_item_id and status in ('approved', 'in_progress');
    end if;
  end if;

  if new.status = 'in_progress' and old.status is distinct from 'in_progress'
     and new.menu_item_id is not null then
    update public.menu_items set status = 'in_progress'
     where id = new.menu_item_id and status = 'approved';
  end if;

  return null;
end $$;

create trigger tasks_notify_update after update on public.tasks
  for each row execute function public.trg_task_updated();

create or replace function public.trg_task_stamp()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger tasks_stamp before update on public.tasks
  for each row execute function public.trg_task_stamp();

-- ---------------------------------------------------------------------------
-- WORKFLOW 4 :: shopping list
-- ---------------------------------------------------------------------------
create or replace function public.trg_shopping_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_who   text;
  v_total numeric;
begin
  select name into v_who from public.users where id = new.added_by;

  select sum(quantity) into v_total
  from public.shopping_list
  where normalized_name = new.normalized_name
    and category = new.category
    and unit = new.unit
    and status = 'pending';

  perform public.fn_notify(
    public.fn_users_by_role('head', 'driver'),
    'shopping_updated',
    'Shopping list updated',
    format('%s added %s %s of %s.%s',
           coalesce(v_who, 'Someone'),
           trim(to_char(new.quantity, 'FM999999990.99')), new.unit, new.item_name,
           case when v_total > new.quantity
                then format(' Consolidated total is now %s %s.',
                            trim(to_char(v_total, 'FM999999990.99')), new.unit)
                else '' end),
    'shopping_item', new.id, '/shopping'
  );
  return null;
end $$;

create trigger shopping_notify_insert after insert on public.shopping_list
  for each row execute function public.trg_shopping_added();

create or replace function public.trg_shopping_purchased()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_who text;
begin
  if new.status = 'purchased' and old.status is distinct from 'purchased' then
    select name into v_who from public.users where id = new.purchased_by;
    perform public.fn_notify(
      array_remove(array[new.added_by], null) || public.fn_users_by_role('head'),
      'shopping_purchased',
      'Purchased: ' || new.item_name,
      format('%s marked %s %s of %s as purchased.',
             coalesce(v_who, 'The driver'),
             trim(to_char(new.quantity, 'FM999999990.99')), new.unit, new.item_name),
      'shopping_item', new.id, '/shopping'
    );
  end if;
  return null;
end $$;

create trigger shopping_notify_purchased after update on public.shopping_list
  for each row execute function public.trg_shopping_purchased();

create or replace function public.trg_shopping_stamp()
returns trigger language plpgsql as $$
begin
  if new.status = 'purchased' and old.status is distinct from 'purchased' then
    new.purchased_at := now();
    new.purchased_by := coalesce(new.purchased_by, auth.uid());
  end if;
  if new.status = 'verified' and old.status is distinct from 'verified' then
    new.verified_at := now();
    new.verified_by := coalesce(new.verified_by, auth.uid());
  end if;
  if new.status = 'pending' then
    new.purchased_at := null; new.purchased_by := null;
    new.verified_at  := null; new.verified_by  := null;
  end if;
  return new;
end $$;

create trigger shopping_stamp before update on public.shopping_list
  for each row execute function public.trg_shopping_stamp();

-- ---------------------------------------------------------------------------
-- Consolidated shopping list.  Individual rows keep their "added by"
-- attribution; this view is what the driver actually shops from.
-- security_invoker keeps the caller's RLS in force.
-- ---------------------------------------------------------------------------
create or replace view public.shopping_consolidated
with (security_invoker = on) as
select
  s.normalized_name,
  min(s.item_name)                                          as item_name,
  s.category,
  s.unit,
  sum(s.quantity)                                           as total_quantity,
  count(*)::int                                             as entry_count,
  case when bool_and(s.status = 'verified')  then 'verified'
       when bool_and(s.status <> 'pending')  then 'purchased'
       else 'pending' end                                   as status,
  case when bool_or(s.priority = 'high')   then 'high'
       when bool_or(s.priority = 'medium') then 'medium'
       else 'low' end                                       as priority,
  array_agg(distinct u.name) filter (where u.name is not null) as contributors,
  array_agg(s.id)                                           as source_ids,
  min(s.created_at)                                         as first_added_at,
  string_agg(distinct nullif(s.notes, ''), ' | ')           as notes
from public.shopping_list s
left join public.users u on u.id = s.added_by
group by s.normalized_name, s.category, s.unit;

-- Bulk status change across every row backing one consolidated line
create or replace function public.set_shopping_status(p_ids uuid[], p_status public.shop_status)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare v_count integer;
begin
  update public.shopping_list
     set status       = p_status,
         purchased_by = case when p_status in ('purchased','verified')
                             then coalesce(purchased_by, auth.uid()) else null end
   where id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Duplicate detection used by the "add item" form
-- ---------------------------------------------------------------------------
create or replace function public.find_similar_shopping_items(
  p_name      text,
  p_threshold real default 0.45
)
returns table (
  id           uuid,
  item_name    text,
  quantity     numeric,
  unit         text,
  category     text,
  added_by_name text,
  score        real
)
language sql stable security invoker set search_path = public
as $$
  select s.id, s.item_name, s.quantity, s.unit, s.category, u.name,
         similarity(s.normalized_name, lower(btrim(p_name))) as score
  from public.shopping_list s
  left join public.users u on u.id = s.added_by
  where s.status = 'pending'
    and (s.normalized_name = lower(btrim(p_name))
         or s.normalized_name like '%' || lower(btrim(p_name)) || '%'
         or lower(btrim(p_name)) like '%' || s.normalized_name || '%'
         or similarity(s.normalized_name, lower(btrim(p_name))) > p_threshold)
  order by score desc
  limit 5;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard aggregate, one round trip
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'upcoming_guests',   (select count(*) from public.guests
                           where arrival_date between current_date and current_date + 7),
    'total_guest_heads', (select coalesce(sum(total_guests), 0) from public.guests
                           where departure_date is null or departure_date >= current_date),
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
-- Mark notifications read
-- ---------------------------------------------------------------------------
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql security invoker set search_path = public
as $$
declare v_count integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
