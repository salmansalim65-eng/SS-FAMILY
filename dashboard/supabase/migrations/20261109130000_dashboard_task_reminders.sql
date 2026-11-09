-- Reminders for tasks: how long before the due time to ring (null = none),
-- and the Google Calendar event that carries the reminder to the phone.
alter table public.dashboard_task_times
  add column if not exists remind_minutes smallint check (remind_minutes in (0, 5, 10, 15, 30, 60, 120, 1440)),
  add column if not exists event_id text check (event_id is null or length(event_id) between 1 and 1024);
