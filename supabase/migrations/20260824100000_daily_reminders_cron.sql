-- ============================================================================
-- SS-FAMILY :: run the reminders function every afternoon
--
-- 12:00 UTC = 15:00 in Riyadh — mid-afternoon, when people are around to read
-- them. The function is idempotent — it skips anything already sent today —
-- so a retry or a double run is harmless.
-- ============================================================================
create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'ss-family-daily-reminders',
  '0 12 * * *',
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
