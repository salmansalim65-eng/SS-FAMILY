-- ============================================================================
-- SS-FAMILY :: Haram pick and drop
--
-- The house is in Madinah. A guest staying here will want to pray at
-- Masjid an-Nabawi, usually more than once a day, and getting them there and
-- back is the single thing they will remember most about the visit. So it is
-- part of the daily plan, not something anyone has to remember to arrange.
--
-- It is also the driver's job — which exposed a gap: a driver could be given
-- a task but never see it, because tasks were readable by family only.
-- ============================================================================
insert into public.stay_plan_templates
  (key, title, description, phase, offset_days, every_days, min_nights, priority, sort_order, is_active)
values
  ('haram_transport', 'Haram pick & drop — Masjid an-Nabawi',
   'Agree in the morning which prayers they want to attend — Fajr, Maghrib and Isha are the usual ones. '
   || 'Be at the door well before the adhan, and agree a meeting point and time for the way back so nobody '
   || 'is left waiting outside. On Friday leave much earlier for Jummah.',
   'daily', 0, 1, 0, 'high', 95, true)
on conflict (key) do nothing;

-- The person collecting them needs to know what time they arrive.
update public.stay_plan_templates
   set description = 'Where everything is, when the family eats, and who to ask for anything. '
                  || 'Ask which prayers they would like to attend at the Haram.'
 where key = 'settle_in';

-- ---------------------------------------------------------------------------
-- A driver may now read the tasks assigned to them, and nothing else: no guest
-- list, no menu, no household chores. Updating their own was already allowed —
-- it was only the read that was missing, which made an assignment invisible.
-- ---------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated using (public.is_family() or assigned_to = auth.uid());

-- Existing visits get the new item.
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
