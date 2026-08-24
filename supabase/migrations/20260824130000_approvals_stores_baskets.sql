-- ============================================================================
-- SS-FAMILY :: approvals, private baskets, stores and vendors
--
-- Five changes that all touch who is allowed to see or decide what:
--
--   1. The head and anyone they trust can put a dish straight on the menu.
--   2. A grocery basket is private until its owner sends it.
--   3. A family member sees their own shopping only; the driver sees all of it.
--   4. Every item can say which shop to buy it from.
--   5. A dish ordered in says which restaurant it comes from.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · who may approve a menu
--
-- The head always can. This flag hands the same standing to one other person
-- (the wife, in practice) without making them head of the family.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists can_approve_menu boolean not null default false;

create or replace function public.can_approve_menu()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'head' or can_approve_menu from public.users where id = auth.uid()),
    false)
$$;

-- ---------------------------------------------------------------------------
-- 2 · vendors and stores
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column if not exists vendor text;          -- the restaurant, for outside dishes

alter table public.shopping_list
  add column if not exists store text;           -- Bindawood, Panda, the corner shop…

alter table public.grocery_catalogue
  add column if not exists default_store text;   -- prefills the store when ticked

-- ---------------------------------------------------------------------------
-- 3 · the basket
--
-- submitted_at null means "still in my basket": mine to change, invisible to
-- everyone else, and not on the driver's list. Sending stamps it, which is
-- what actually puts the item in front of the driver.
-- ---------------------------------------------------------------------------
alter table public.shopping_list
  add column if not exists submitted_at timestamptz;

create index if not exists shopping_basket_idx
  on public.shopping_list (added_by, submitted_at);

-- Everything that exists today was added under the old rules, where a tick
-- went straight to the driver. Treat it as already sent.
update public.shopping_list set submitted_at = created_at where submitted_at is null;

-- ---------------------------------------------------------------------------
-- Only a sent item is worth telling the driver about, and it is worth telling
-- them once — not on every tick. So the notification moves from INSERT to the
-- moment the basket is sent.
-- ---------------------------------------------------------------------------
drop trigger if exists shopping_notify_insert on public.shopping_list;
drop function if exists public.trg_shopping_added();

create or replace function public.trg_shopping_submitted()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_who   text;
  v_count integer;
  v_where text;
begin
  select name into v_who from public.users where id = new.added_by;

  -- One notification per basket, not per line: count everything this person
  -- sent in the same instant and let the first row speak for all of them.
  select count(*) into v_count
  from public.shopping_list
  where added_by = new.added_by and submitted_at = new.submitted_at;

  if exists (
    select 1 from public.shopping_list
    where added_by = new.added_by
      and submitted_at = new.submitted_at
      and id < new.id
  ) then
    return null;   -- an earlier row in this batch already sent the notice
  end if;

  select string_agg(distinct store, ', ')
    into v_where
  from public.shopping_list
  where added_by = new.added_by and submitted_at = new.submitted_at
    and coalesce(store, '') <> '';

  perform public.fn_notify(
    public.fn_users_by_role('head', 'driver'),
    'shopping_updated',
    'Shopping list from ' || coalesce(v_who, 'the family'),
    format('%s sent %s item(s) to buy.%s',
           coalesce(v_who, 'Someone'), v_count,
           case when v_where is null then '' else ' Shops: ' || v_where || '.' end),
    'shopping_item', new.id, '/shopping'
  );
  return null;
end $$;

create trigger shopping_notify_submitted
  after update of submitted_at on public.shopping_list
  for each row
  when (old.submitted_at is null and new.submitted_at is not null)
  execute function public.trg_shopping_submitted();

-- ---------------------------------------------------------------------------
-- Sends the caller's whole basket in one stamp, so the trigger above can group
-- it. Returns how many items went.
-- ---------------------------------------------------------------------------
create or replace function public.submit_my_basket()
returns integer
language plpgsql security invoker set search_path = public
as $$
declare v_count integer;
begin
  update public.shopping_list
     set submitted_at = now()
   where added_by = auth.uid()
     and submitted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.submit_my_basket() from public, anon;
grant execute on function public.submit_my_basket() to authenticated;
revoke all on function public.can_approve_menu() from public, anon;
grant execute on function public.can_approve_menu() to authenticated;
revoke all on function public.trg_shopping_submitted() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · a family member sees their own shopping, and nobody else's
--
-- The head still sees everything (they run the household) and so does the
-- driver (they buy it). A member sees their own basket and their own sent
-- items — which is the whole point of a basket being private.
-- ---------------------------------------------------------------------------
drop policy if exists shopping_select on public.shopping_list;
create policy shopping_select on public.shopping_list
  for select to authenticated using (
    added_by = auth.uid()
    or public.is_head()
    or (public.is_driver() and submitted_at is not null)
  );

drop policy if exists shopping_update on public.shopping_list;
create policy shopping_update on public.shopping_list
  for update to authenticated
  using (public.is_head() or added_by = auth.uid() or public.is_driver())
  with check (public.is_head() or added_by = auth.uid() or public.is_driver());

-- An unsent item is yours to delete whatever its status.
drop policy if exists shopping_delete on public.shopping_list;
create policy shopping_delete on public.shopping_list
  for delete to authenticated using (
    public.is_head()
    or (added_by = auth.uid() and (submitted_at is null or status = 'pending'))
  );

-- ---------------------------------------------------------------------------
-- The consolidated view now merges per store as well, and ignores baskets
-- that have not been sent. security_invoker means it still shows each caller
-- only the rows their policy allows.
-- ---------------------------------------------------------------------------
drop view if exists public.shopping_consolidated;
create view public.shopping_consolidated
with (security_invoker = on) as
select
  s.normalized_name,
  min(s.item_name)                                          as item_name,
  s.category,
  s.unit,
  coalesce(nullif(btrim(s.store), ''), 'Any shop')          as store,
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
where s.submitted_at is not null
group by s.normalized_name, s.category, s.unit,
         coalesce(nullif(btrim(s.store), ''), 'Any shop');

grant select on public.shopping_consolidated to authenticated;

-- ---------------------------------------------------------------------------
-- 5 · the driver's own list: every sent item, with who wants it and from where
-- ---------------------------------------------------------------------------
create or replace view public.shopping_for_driver
with (security_invoker = on) as
select
  s.id,
  s.item_name,
  s.category,
  s.quantity,
  s.unit,
  coalesce(nullif(btrim(s.store), ''), 'Any shop') as store,
  s.status,
  s.priority,
  s.notes,
  s.added_by,
  coalesce(u.name, 'Someone')                      as requested_by,
  s.submitted_at,
  s.created_at
from public.shopping_list s
left join public.users u on u.id = s.added_by
where s.submitted_at is not null;

grant select on public.shopping_for_driver to authenticated;

-- The dashboard counted consolidated lines; keep it counting whole items.
create or replace function public.dashboard_stats()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'guests_upcoming', (select count(*) from public.guests
                         where arrival_date >= current_date),
    'guests_staying',  (select count(*) from public.guests
                         where arrival_date >= current_date and guest_type = 'staying'),
    'guests_dinner',   (select count(*) from public.guests
                         where arrival_date >= current_date and guest_type = 'dinner'),
    'guests_total',    (select coalesce(sum(total_guests), 0) from public.guests
                         where arrival_date >= current_date),
    'menu_pending',    (select count(*) from public.menu_items where status = 'draft'),
    'tasks_open',      (select count(*) from public.tasks where status <> 'completed'),
    'tasks_overdue',   (select count(*) from public.tasks
                         where status <> 'completed' and due_date < current_date),
    'shopping_pending',(select count(*) from public.shopping_list
                         where status = 'pending' and submitted_at is not null),
    'unread_notifications', (select count(*) from public.notifications
                              where user_id = auth.uid() and read_at is null)
  );
$$;

revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · a dish from the head, or from anyone they trust, needs no approval
--
-- The guard used to insist every non-head insert was a DRAFT. Now it lets an
-- approver insert an approved dish, and stamps the approval itself so the row
-- cannot claim to have been approved by somebody else.
-- ---------------------------------------------------------------------------
create or replace function public.guard_menu_items()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.suggested_by := coalesce(new.suggested_by, auth.uid());

    if public.can_approve_menu() then
      -- Their own suggestion goes straight on the menu.
      if new.status = 'draft' then new.status := 'approved'; end if;
      if new.status = 'approved' then
        new.approved_by   := auth.uid();
        new.approver_date := now();
      end if;
    elsif new.status <> 'draft' then
      raise exception 'Family members can only suggest menu items as DRAFT';
    end if;

    return new;
  end if;

  if new.status is distinct from old.status then
    if (new.status in ('approved', 'rejected') or old.status in ('approved', 'rejected'))
       and not public.can_approve_menu() then
      -- the assigned cook may still push an approved dish through its own
      -- progress states
      if not (old.status = 'approved'
              and new.status = 'in_progress'
              and auth.uid() in (old.cook_person, old.outside_responsible)) then
        raise exception 'Only the head of family can approve or reject menu items';
      end if;
    end if;
  end if;

  return new;
end $$;

-- A dish that arrives already approved skipped the UPDATE that normally makes
-- its task. Run the same work on insert instead.
create or replace function public.trg_menu_suggested()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_who      text;
  v_assignee uuid;
  v_title    text;
  v_due      date;
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
    return null;
  end if;

  if new.status = 'approved' then
    v_assignee := case
      when new.homemade_or_outside = 'outside'
        then coalesce(new.outside_responsible, new.cook_person, new.suggested_by)
      else coalesce(new.cook_person, new.suggested_by)
    end;

    v_title := case when new.homemade_or_outside = 'outside'
                    then 'Buy ' || new.dish_name
                    else 'Cook ' || new.dish_name end;

    v_due := coalesce(new.serve_date, current_date);

    insert into public.tasks
      (title, description, task_type, assigned_to, due_date, priority, status,
       menu_item_id, guest_id, created_by)
    values (
      v_title,
      format('Approved menu item. Quantity: %s %s.%s Estimated cost: SAR %s.%s',
             public.fmt_num(new.quantity),
             coalesce(new.unit, 'serving'),
             case when new.homemade_or_outside = 'outside'
                       and coalesce(new.vendor, '') <> ''
                  then ' From: ' || new.vendor || '.' else '' end,
             public.fmt_num(new.cost),
             case when coalesce(new.notes, '') = '' then ''
                  else ' Notes: ' || new.notes end),
      'menu', v_assignee, v_due,
      case when v_due - current_date <= 1 then 'high'::public.priority_level
           else 'medium'::public.priority_level end,
      'pending', new.id, new.guest_id, new.suggested_by
    );

    perform public.fn_notify(
      array_remove(array[new.cook_person, new.outside_responsible], null)
        || public.fn_users_by_role('head'),
      'menu_approved',
      'On the menu: ' || new.dish_name,
      format('%s added "%s"%s. A task has been created and assigned.',
             coalesce(v_who, 'The head of family'), new.dish_name,
             case when new.homemade_or_outside = 'outside'
                       and coalesce(new.vendor, '') <> ''
                  then ' from ' || new.vendor else '' end),
      'menu_item', new.id, '/menu'
    );
  end if;

  return null;
end $$;

-- The approval path (draft → approved) also mentions the restaurant now.
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
        format('Approved menu item. Quantity: %s %s.%s Estimated cost: SAR %s.%s',
               public.fmt_num(new.quantity),
               coalesce(new.unit, 'serving'),
               case when new.homemade_or_outside = 'outside'
                         and coalesce(new.vendor, '') <> ''
                    then ' From: ' || new.vendor || '.' else '' end,
               public.fmt_num(new.cost),
               case when coalesce(new.notes, '') = '' then ''
                    else ' Notes: ' || new.notes end),
        'menu', v_assignee, v_due,
        case when v_due - current_date <= 1 then 'high'::public.priority_level
             else 'medium'::public.priority_level end,
        'pending', new.id, new.guest_id, new.approved_by
      );
    end if;

    select name into v_name from public.users where id = new.approved_by;

    perform public.fn_notify(
      array_remove(array[new.suggested_by, new.cook_person, new.outside_responsible], null)
        || public.fn_users_by_role('head'),
      'menu_approved',
      'Menu approved: ' || new.dish_name,
      format('"%s" was approved by %s%s. A task has been created and assigned.',
             new.dish_name, coalesce(v_name, 'the head of family'),
             case when new.homemade_or_outside = 'outside'
                       and coalesce(new.vendor, '') <> ''
                  then ', from ' || new.vendor else '' end),
      'menu_item', new.id, '/menu'
    );

  elsif old.status = 'approved' and (
        new.dish_name           is distinct from old.dish_name or
        new.serve_date          is distinct from old.serve_date or
        new.quantity            is distinct from old.quantity or
        new.vendor              is distinct from old.vendor or
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

  if new.serve_date is distinct from old.serve_date then
    update public.tasks set due_date = new.serve_date
     where menu_item_id = new.id and status <> 'completed';
  end if;

  return null;
end $$;

-- Menu policies followed role = 'head'; they follow the flag now.
drop policy if exists menu_update on public.menu_items;
create policy menu_update on public.menu_items
  for update to authenticated
  using (
    public.can_approve_menu()
    or (suggested_by = auth.uid() and status = 'draft')
    or auth.uid() in (cook_person, outside_responsible)
  )
  with check (public.is_family());

drop policy if exists menu_delete on public.menu_items;
create policy menu_delete on public.menu_items
  for delete to authenticated
  using (public.can_approve_menu() or (suggested_by = auth.uid() and status = 'draft'));
