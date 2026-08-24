-- ============================================================================
-- SS-FAMILY :: tidy quantities in notification text
--
-- to_char(2, 'FM999999990.99') leaves a trailing dot — "2. kg". Strip the
-- zeros, then the dot, so whole numbers read "2 kg" and halves read "2.5 kg".
-- ============================================================================
create or replace function public.fmt_num(p numeric)
returns text
language sql immutable set search_path = public
as $$ select rtrim(rtrim(to_char(p, 'FM999999990.99'), '0'), '.') $$;

revoke all on function public.fmt_num(numeric) from public, anon, authenticated;

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
           public.fmt_num(new.quantity), new.unit, new.item_name,
           case when v_total > new.quantity
                then format(' Consolidated total is now %s %s.',
                            public.fmt_num(v_total), new.unit)
                else '' end),
    'shopping_item', new.id, '/shopping'
  );
  return null;
end $$;

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
             public.fmt_num(new.quantity), new.unit, new.item_name),
      'shopping_item', new.id, '/shopping'
    );
  end if;
  return null;
end $$;

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
               public.fmt_num(new.quantity),
               coalesce(new.unit, 'serving'),
               public.fmt_num(new.cost),
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

  -- ---- material change after approval --------------------------------------
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

  if new.serve_date is distinct from old.serve_date then
    update public.tasks set due_date = new.serve_date
     where menu_item_id = new.id and status <> 'completed';
  end if;

  return null;
end $$;

