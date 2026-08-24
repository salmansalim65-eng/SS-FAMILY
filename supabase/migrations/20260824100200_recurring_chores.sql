-- ============================================================================
-- SS-FAMILY :: recurring household chores
--
-- A chore is a template. A nightly job turns it into a real row in `tasks`
-- when it falls due, so chores inherit the same assignment, notification,
-- reminder and completion handling as every other task.
-- ============================================================================
create table if not exists public.recurring_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  assigned_to  uuid references public.users (id) on delete set null,
  priority     public.priority_level not null default 'medium',
  frequency    text not null check (frequency in ('daily','weekly','monthly')),
  day_of_week  integer check (day_of_week between 0 and 6),   -- 0 = Sunday
  day_of_month integer check (day_of_month between 1 and 28), -- never skips a short month
  is_active    boolean not null default true,
  next_due     date not null default current_date,
  last_generated_on date,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists recurring_next_due_idx
  on public.recurring_tasks (is_active, next_due);

drop trigger if exists recurring_tasks_touch on public.recurring_tasks;
create trigger recurring_tasks_touch before update on public.recurring_tasks
  for each row execute function public.touch_updated_at();

create or replace function public.next_occurrence(
  p_from date, p_frequency text, p_dow integer, p_dom integer
) returns date
language plpgsql immutable set search_path = public
as $$
declare v_next date;
begin
  if p_frequency = 'daily' then
    return p_from + 1;

  elsif p_frequency = 'weekly' then
    v_next := p_from + 7;
    if p_dow is not null then
      v_next := v_next + ((p_dow - extract(dow from v_next)::int + 7) % 7);
    end if;
    return v_next;

  else -- monthly
    v_next := (date_trunc('month', p_from) + interval '1 month')::date;
    if p_dom is not null then
      v_next := v_next + (p_dom - 1);
    else
      v_next := v_next + (extract(day from p_from)::int - 1);
    end if;
    return v_next;
  end if;
end $$;

-- Creates the tasks that are due, then walks next_due past today.
-- A chore that has been dormant for months produces ONE task, not a backlog.
-- Only the head may press "run now"; cron (auth.uid() is null) always may.
create or replace function public.generate_recurring_tasks()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  c       record;
  v_made  integer := 0;
  v_next  date;
  v_guard integer;
begin
  if auth.uid() is not null and not public.is_head() then
    raise exception 'Only the head of family can generate chores';
  end if;

  for c in
    select * from public.recurring_tasks
    where is_active and next_due <= current_date
  loop
    if not exists (
      select 1 from public.tasks
      where title = c.title
        and task_type = 'household'
        and due_date = c.next_due
        and status <> 'completed'
    ) then
      insert into public.tasks
        (title, description, task_type, assigned_to, due_date, priority, status, created_by)
      values (c.title, c.description, 'household', c.assigned_to,
              greatest(c.next_due, current_date), c.priority, 'pending', c.created_by);
      v_made := v_made + 1;
    end if;

    v_next  := c.next_due;
    v_guard := 0;
    while v_next <= current_date and v_guard < 400 loop
      v_next  := public.next_occurrence(v_next, c.frequency, c.day_of_week, c.day_of_month);
      v_guard := v_guard + 1;
    end loop;

    update public.recurring_tasks
       set next_due = v_next, last_generated_on = current_date
     where id = c.id;
  end loop;

  return v_made;
end $$;

alter table public.recurring_tasks enable row level security;

drop policy if exists recurring_select on public.recurring_tasks;
create policy recurring_select on public.recurring_tasks
  for select to authenticated using (public.is_family());

drop policy if exists recurring_insert on public.recurring_tasks;
create policy recurring_insert on public.recurring_tasks
  for insert to authenticated with check (public.is_head());

drop policy if exists recurring_update on public.recurring_tasks;
create policy recurring_update on public.recurring_tasks
  for update to authenticated
  using (public.is_head()) with check (public.is_head());

drop policy if exists recurring_delete on public.recurring_tasks;
create policy recurring_delete on public.recurring_tasks
  for delete to authenticated using (public.is_head());

grant select, insert, update, delete on public.recurring_tasks to authenticated;

revoke all on function public.next_occurrence(date, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.generate_recurring_tasks() from public, anon, authenticated;
grant execute on function public.generate_recurring_tasks() to authenticated;

-- 03:10 UTC = 06:10 Riyadh, just after the reminders run.
select cron.schedule(
  'ss-family-recurring-chores',
  '10 3 * * *',
  $job$ select public.generate_recurring_tasks(); $job$
);
