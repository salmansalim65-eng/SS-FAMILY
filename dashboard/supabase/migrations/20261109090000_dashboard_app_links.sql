-- Icons may also open an installed desktop app through its link scheme
-- (whatsapp://, msteams:, ...), not only web pages. javascript: and data:
-- stay out.
alter table public.dashboard_apps drop constraint if exists dashboard_apps_url_check;
alter table public.dashboard_apps add constraint dashboard_apps_url_check
  check (url ~* '^(https?://|(whatsapp|msteams|skype|zoommtg|tg|mailto|tel):)');
