-- ============================================================================
-- SS-FAMILY :: authentication hook, permission guards and row level security
-- ============================================================================

-- ---------------------------------------------------------------------------
-- New signup -> profile row.  Role comes from the signup metadata and
-- defaults to 'member'; the very first account created becomes the head.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  begin
    v_role := coalesce(nullif(v_meta ->> 'role', ''), 'member')::public.user_role;
  exception when others then
    v_role := 'member';
  end;

  if not exists (select 1 from public.users) then
    v_role := 'head';
  end if;

  insert into public.users (id, name, email, phone, whatsapp_number, role)
  values (
    new.id,
    coalesce(nullif(v_meta ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(v_meta ->> 'phone', ''),
    nullif(v_meta ->> 'whatsapp_number', ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Permission guards.
-- pg_trigger_depth() > 1 means the write came from one of our own workflow
-- triggers (menu approval creating a task, a task completing its menu item),
-- which is trusted and must not be blocked.
-- ---------------------------------------------------------------------------

-- Only the head may change anybody's role, including their own.
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
  if new.id is distinct from old.id then
    raise exception 'User id is immutable';
  end if;
  return new;
end $$;

create trigger users_guard before update on public.users
  for each row execute function public.guard_users();

-- Menu: suggestions land as drafts; only the head approves or rejects.
create or replace function public.guard_menu_items()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not public.is_head() then
      raise exception 'Family members can only suggest menu items as DRAFT';
    end if;
    new.suggested_by := coalesce(new.suggested_by, auth.uid());
    return new;
  end if;

  if new.status is distinct from old.status then
    -- approve / reject / un-approve is the head's call
    if (new.status in ('approved', 'rejected') or old.status in ('approved', 'rejected'))
       and not public.is_head() then
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

create trigger menu_guard before insert or update on public.menu_items
  for each row execute function public.guard_menu_items();

-- Tasks: the assignee owns the status column and nothing else.
create or replace function public.guard_tasks()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or public.is_head() then
    return new;
  end if;

  if auth.uid() = old.assigned_to then
    if new.title       is distinct from old.title
    or new.description is distinct from old.description
    or new.assigned_to is distinct from old.assigned_to
    or new.due_date    is distinct from old.due_date
    or new.due_time    is distinct from old.due_time
    or new.priority    is distinct from old.priority
    or new.task_type   is distinct from old.task_type then
      raise exception 'You can only update the status of a task assigned to you';
    end if;
    return new;
  end if;

  raise exception 'Only the head of family can modify tasks';
end $$;

create trigger tasks_guard before update on public.tasks
  for each row execute function public.guard_tasks();

-- Shopping: the driver may only tick items off.
create or replace function public.guard_shopping()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.added_by := coalesce(new.added_by, auth.uid());
    return new;
  end if;

  if public.is_driver() then
    if new.item_name is distinct from old.item_name
    or new.quantity  is distinct from old.quantity
    or new.unit      is distinct from old.unit
    or new.category  is distinct from old.category
    or new.added_by  is distinct from old.added_by
    or new.priority  is distinct from old.priority then
      raise exception 'The driver can only mark items as purchased';
    end if;
  end if;

  return new;
end $$;

create trigger shopping_guard before insert or update on public.shopping_list
  for each row execute function public.guard_shopping();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.users         enable row level security;
alter table public.guests        enable row level security;
alter table public.menu_items    enable row level security;
alter table public.tasks         enable row level security;
alter table public.shopping_list enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log  enable row level security;

-- users ---------------------------------------------------------------------
create policy users_select on public.users
  for select to authenticated using (true);

create policy users_insert_self on public.users
  for insert to authenticated with check (id = auth.uid());

create policy users_update on public.users
  for update to authenticated
  using (id = auth.uid() or public.is_head())
  with check (id = auth.uid() or public.is_head());

create policy users_delete_head on public.users
  for delete to authenticated using (public.is_head());

-- guests --------------------------------------------------------------------
create policy guests_select on public.guests
  for select to authenticated using (public.is_family());

create policy guests_insert on public.guests
  for insert to authenticated with check (public.is_family());

create policy guests_update on public.guests
  for update to authenticated
  using (public.is_family()) with check (public.is_family());

create policy guests_delete on public.guests
  for delete to authenticated using (public.is_head());

-- menu_items ----------------------------------------------------------------
create policy menu_select on public.menu_items
  for select to authenticated using (public.is_family());

create policy menu_insert on public.menu_items
  for insert to authenticated with check (public.is_family());

create policy menu_update on public.menu_items
  for update to authenticated
  using (
    public.is_head()
    or (suggested_by = auth.uid() and status = 'draft')
    or auth.uid() in (cook_person, outside_responsible)
  )
  with check (public.is_family());

create policy menu_delete on public.menu_items
  for delete to authenticated
  using (public.is_head() or (suggested_by = auth.uid() and status = 'draft'));

-- tasks ---------------------------------------------------------------------
create policy tasks_select on public.tasks
  for select to authenticated using (public.is_family());

create policy tasks_insert on public.tasks
  for insert to authenticated with check (public.is_head());

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_head() or assigned_to = auth.uid())
  with check (public.is_head() or assigned_to = auth.uid());

create policy tasks_delete on public.tasks
  for delete to authenticated using (public.is_head());

-- shopping_list -------------------------------------------------------------
-- the driver can read the whole list (they shop from it) but nothing else
create policy shopping_select on public.shopping_list
  for select to authenticated using (public.is_family() or public.is_driver());

create policy shopping_insert on public.shopping_list
  for insert to authenticated with check (public.is_family());

create policy shopping_update on public.shopping_list
  for update to authenticated
  using (public.is_head() or added_by = auth.uid() or public.is_driver())
  with check (public.is_head() or added_by = auth.uid() or public.is_driver());

create policy shopping_delete on public.shopping_list
  for delete to authenticated
  using (public.is_head() or (added_by = auth.uid() and status = 'pending'));

-- notifications -------------------------------------------------------------
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- activity_log --------------------------------------------------------------
create policy activity_select on public.activity_log
  for select to authenticated using (public.is_family());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.users, public.guests, public.menu_items,
  public.tasks, public.shopping_list, public.notifications
  to authenticated;

grant select on public.activity_log, public.shopping_consolidated to authenticated;

grant execute on function
  public.app_role(), public.is_head(), public.is_family(), public.is_driver(),
  public.dashboard_stats(), public.mark_all_notifications_read(),
  public.find_similar_shopping_items(text, real),
  public.set_shopping_status(uuid[], public.shop_status)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.shopping_list;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.menu_items;
exception when duplicate_object then null; end $$;
