-- ============================================================================
-- SS-FAMILY :: guest history
--
-- Visits stay in `guests`. A profile is the rolled-up record of one guest or
-- family across all of them: how often they have come, how many nights, and
-- what we have learned about them.
--
-- Profiles are derived, with one exception: `notes` is curated by the family
-- and the sync never touches it. That is the field that answers "what does
-- this guest prefer" on their next visit.
-- ============================================================================
create table if not exists public.guest_profiles (
  id                 uuid primary key default gen_random_uuid(),
  normalized_name    text not null unique,
  display_name       text not null,
  relationship       text,
  default_room       text,
  phone              text,
  origin_city        text,
  notes              text,
  last_special_needs text,
  first_visit        date,
  last_visit         date,
  visit_count        integer not null default 0,
  staying_count      integer not null default 0,
  dinner_count       integer not null default 0,
  total_nights       integer not null default 0,
  total_guests_seen  integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists guest_profiles_last_visit_idx
  on public.guest_profiles (last_visit desc);

create or replace function public.sync_guest_profile(p_norm text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v record;
begin
  select
    count(*)                                       as visits,
    count(*) filter (where guest_type = 'staying') as stays,
    count(*) filter (where guest_type = 'dinner')  as dinners,
    min(arrival_date)                              as first_visit,
    max(arrival_date)                              as last_visit,
    coalesce(sum(
      case when guest_type = 'staying' and departure_date is not null
           then greatest(departure_date - arrival_date, 0) else 0 end), 0) as nights,
    coalesce(max(total_guests), 0)                 as biggest_party
  into v
  from public.guests
  where lower(btrim(name)) = p_norm;

  if v.visits = 0 then
    delete from public.guest_profiles where normalized_name = p_norm;
    return;
  end if;

  insert into public.guest_profiles as gp (
    normalized_name, display_name, relationship, default_room, phone, origin_city,
    last_special_needs, first_visit, last_visit, visit_count, staying_count,
    dinner_count, total_nights, total_guests_seen
  )
  select
    p_norm, g.name, g.relationship, g.room, g.phone, g.origin_city, g.special_needs,
    v.first_visit, v.last_visit, v.visits, v.stays, v.dinners, v.nights, v.biggest_party
  from public.guests g
  where lower(btrim(g.name)) = p_norm
  order by g.arrival_date desc, g.created_at desc
  limit 1
  on conflict (normalized_name) do update set
    display_name       = excluded.display_name,
    relationship       = coalesce(excluded.relationship, gp.relationship),
    default_room       = coalesce(excluded.default_room, gp.default_room),
    phone              = coalesce(excluded.phone, gp.phone),
    origin_city        = coalesce(excluded.origin_city, gp.origin_city),
    last_special_needs = coalesce(excluded.last_special_needs, gp.last_special_needs),
    first_visit        = excluded.first_visit,
    last_visit         = excluded.last_visit,
    visit_count        = excluded.visit_count,
    staying_count      = excluded.staying_count,
    dinner_count       = excluded.dinner_count,
    total_nights       = excluded.total_nights,
    total_guests_seen  = excluded.total_guests_seen,
    updated_at         = now();
    -- `notes` is deliberately absent.
end $$;

create or replace function public.trg_guest_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.sync_guest_profile(lower(btrim(old.name)));
  end if;
  if tg_op <> 'DELETE' then
    perform public.sync_guest_profile(lower(btrim(new.name)));
  end if;
  return null;
end $$;

drop trigger if exists guests_profile_sync on public.guests;
create trigger guests_profile_sync
  after insert or update or delete on public.guests
  for each row execute function public.trg_guest_profile();

do $$
declare n text;
begin
  for n in select distinct lower(btrim(name)) from public.guests loop
    perform public.sync_guest_profile(n);
  end loop;
end $$;

create or replace view public.guest_visits
with (security_invoker = on) as
select
  g.id,
  lower(btrim(g.name)) as normalized_name,
  g.name, g.guest_type, g.arrival_date, g.departure_date, g.event_time,
  g.male_count, g.female_count, g.total_guests, g.room, g.special_needs, g.relationship,
  case when g.guest_type = 'staying' and g.departure_date is not null
       then greatest(g.departure_date - g.arrival_date, 0) end as nights,
  g.created_at
from public.guests g;

alter table public.guest_profiles enable row level security;

drop policy if exists guest_profiles_select on public.guest_profiles;
create policy guest_profiles_select on public.guest_profiles
  for select to authenticated using (public.is_family());

drop policy if exists guest_profiles_update on public.guest_profiles;
create policy guest_profiles_update on public.guest_profiles
  for update to authenticated
  using (public.is_family()) with check (public.is_family());

drop policy if exists guest_profiles_delete on public.guest_profiles;
create policy guest_profiles_delete on public.guest_profiles
  for delete to authenticated using (public.is_head());

grant select, update, delete on public.guest_profiles to authenticated;
grant select on public.guest_visits to authenticated;

-- New functions default to PUBLIC EXECUTE; lock them down like the rest.
revoke all on function public.sync_guest_profile(text) from public, anon, authenticated;
revoke all on function public.trg_guest_profile() from public, anon, authenticated;
