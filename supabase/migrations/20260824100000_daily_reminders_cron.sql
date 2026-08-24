-- ============================================================================
-- SS-FAMILY :: run the reminders function every morning
--
-- 03:00 UTC = 06:00 in Riyadh, so "your task is due tomorrow" and "a guest
-- arrives in 3 days" land first thing. The function is idempotent — it skips
-- anything already sent today — so a retry or a double run is harmless.
-- ============================================================================
create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'ss-family-daily-reminders',
  '0 3 * * *',
  $job$
    select net.http_post(
      url     := 'https://fhhecuvtgukcfulynwje.supabase.co/functions/v1/reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $job$
);

-- Deploying to a different project? Change the host above, then check with:
--   select jobname, schedule, active from cron.job;
--   select status_code, content from net._http_response order by id desc limit 5;
