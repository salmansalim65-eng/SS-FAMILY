-- ============================================================================
-- SS-FAMILY :: actually deliver the queued WhatsApp messages
--
-- fn_notify already queues a row for anyone with a WhatsApp number on file.
-- Nothing drained that queue, so it just grew. This adds the drain, plus the
-- attempt counter that stops a transient network blip from silently losing a
-- message (and stops a permanently bad number from being retried forever).
-- ============================================================================
alter table public.notifications
  add column if not exists whatsapp_attempts integer not null default 0;

-- 'system' carries the "send me a test message" ping from Settings, which is
-- not about a guest, a dish, a task or the shopping.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('guest_added','menu_suggested','menu_approved','menu_changed',
                  'task_assigned','task_due','task_completed',
                  'shopping_updated','shopping_purchased','guest_arriving',
                  'system'));

-- The drain picks up 'queued' and 'failed' rows, so the index has to cover both.
drop index if exists public.notifications_wa_idx;
create index if not exists notifications_wa_idx
  on public.notifications (whatsapp_status, whatsapp_attempts)
  where whatsapp_status in ('queued', 'failed');

-- Every 5 minutes: quick enough that a notification feels immediate, slow
-- enough to be nearly free. The function is a no-op when nothing is queued.
select cron.schedule(
  'ss-family-whatsapp-drain',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url     := 'https://fhhecuvtgukcfulynwje.supabase.co/functions/v1/send-whatsapp',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $job$
);

-- The queue has been filling up since the day the app went live. Switching
-- delivery on should not fire that whole backlog at people's phones, so retire
-- anything already stale; the drain applies the same 24-hour rule from here on.
update public.notifications
   set whatsapp_status = 'disabled',
       whatsapp_error  = 'Queued before WhatsApp delivery was switched on.'
 where whatsapp_status = 'queued'
   and created_at < now() - interval '24 hours';
