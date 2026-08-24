-- ============================================================================
-- SS-FAMILY :: push notifications, and the end of the Twilio path
--
-- WhatsApp cannot be sent from an app without Meta's Business API or a
-- reseller, and we are using neither. The app pushes its own notifications
-- instead: free, instant, no third party, and no 24-hour window.
--
-- A subscription belongs to a *device*, not a person — one member may have a
-- phone and a laptop, and each gets its own row.
-- ============================================================================
select cron.unschedule('ss-family-whatsapp-drain')
 where exists (select 1 from cron.job where jobname = 'ss-family-whatsapp-drain');

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  device_label text,
  failures    integer not null default 0,
  last_used_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- notifications: push replaces the WhatsApp queue outright
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists push_status text not null default 'queued',
  add column if not exists push_error  text;

alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
  check (push_status in ('queued','sent','no_device','failed'));

alter table public.notifications drop column if exists whatsapp_status;
alter table public.notifications drop column if exists whatsapp_error;
alter table public.notifications drop column if exists whatsapp_attempts;

drop index if exists public.notifications_wa_idx;
create index if not exists notifications_push_idx
  on public.notifications (push_status, created_at)
  where push_status = 'queued';

-- ---------------------------------------------------------------------------
-- Everyone gets a push row; the sender decides at delivery time whether the
-- recipient actually has a device registered. That keeps fn_notify ignorant
-- of devices, which come and go.
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
    (user_id, type, title, message, entity_type, entity_id, link, sent_via, push_status)
  select distinct u.id, p_type, p_title, p_message, p_entity_type, p_entity_id, p_link,
         array['in_app','push'], 'queued'
  from public.users u
  where u.id = any(p_users)
    and u.is_active
    and u.id is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.fn_notify(uuid[], text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_notify(uuid[], text, text, text, text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- A device registration is personal: you may add and remove your own, and the
-- head can clear someone else's when they lose a phone.
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid() or public.is_head());

drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_subs_update on public.push_subscriptions;
create policy push_subs_update on public.push_subscriptions
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid() or public.is_head());

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Every minute: a notification should feel immediate. The function returns
-- straight away when the queue is empty, so an idle minute costs nothing.
select cron.schedule(
  'ss-family-push-drain',
  '* * * * *',
  $job$
    select net.http_post(
      url     := 'https://fhhecuvtgukcfulynwje.supabase.co/functions/v1/send-push',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $job$
);

-- Nothing from before today is worth pushing at anyone.
update public.notifications set push_status = 'no_device' where created_at < now() - interval '1 hour';
