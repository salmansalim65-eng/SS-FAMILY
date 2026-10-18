-- Starting content: the four project icons, the personal tiles, and the
-- report cards. Everything here is editable from the Settings page.
-- Only seeds an empty table, so re-running it never duplicates rows.

insert into public.dashboard_apps (name, url, icon, color, category, sort_order)
select * from (values
  ('MBL',              'https://example.com/mbl',            'MBL', '#2563eb', 'project', 10),
  ('RMI',              'https://example.com/rmi',            'RMI', '#16a34a', 'project', 20),
  ('SSA',              'https://example.com/ssa',            'SSA', '#ea580c', 'project', 30),
  ('VISTA',            'https://example.com/vista',          'VI',  '#9333ea', 'project', 40),
  ('Mera',             'https://example.com/mera',           'M',   '#0891b2', 'personal', 10),
  ('SS Family',        'https://example.com/ss-family',      'SS',  '#db2777', 'personal', 20),
  ('Google Calendar',  'https://calendar.google.com',        '📅',  '#1a73e8', 'personal', 30),
  ('Microsoft To Do',  'https://to-do.office.com',           '✔',   '#2564cf', 'personal', 40)
) as v(name, url, icon, color, category, sort_order)
where not exists (select 1 from public.dashboard_apps);

-- RMI: key-guarded functions from project-examples/rmi_dashboard_metrics.sql,
-- called with RMI_DASHBOARD_KEY.
-- MBL / SSA / VISTA: placeholders with sample numbers.
-- SS_FAMILY: live, through key-guarded functions in the SS Family project.
-- TODO: switch each placeholder to query_type 'count' / 'sum' / 'rpc' and
--       fill in table_name, value_column, date_column and filter once the
--       real tables are known.
insert into public.dashboard_cards
  (project, title, query_type, table_name, value_column, date_column, date_range, filter, format, sample_value, sample_previous, higher_is_better, sort_order)
select * from (values
  ('RMI',   'Total students',          'rpc', 'home_dashboard_students',     null, null, 'all', '[]'::jsonb, 'number',   null::numeric, null::numeric, true::boolean, 10),
  ('RMI',   'Fee collected today',     'rpc', 'home_dashboard_fee_today',    null, null, 'all', '[]'::jsonb, 'currency', null, null, true,  20),
  ('RMI',   'Pending dues',            'rpc', 'home_dashboard_pending_dues', null, null, 'all', '[]'::jsonb, 'currency', null, null, false, 30),
  ('RMI',   'Out-of-stock items',      'rpc', 'home_dashboard_out_of_stock', null, null, 'all', '[]'::jsonb, 'number',   null, null, false, 40),
  ('RMI',   'Payroll this month',      'rpc', 'home_dashboard_payroll',      null, null, 'all', '[]'::jsonb, 'currency', null, null, true,  50),

  ('MBL',   'Active customers',        'placeholder', null, null, null, 'all', '[]'::jsonb, 'number',   1240,   1180, true, 10),
  ('MBL',   'Revenue this month',      'placeholder', null, null, null, 'all', '[]'::jsonb, 'currency', 845000, 790000, true, 20),
  ('MBL',   'Open orders',             'placeholder', null, null, null, 'all', '[]'::jsonb, 'number',   37,     42, true, 30),

  ('SSA',   'Members',                 'placeholder', null, null, null, 'all', '[]'::jsonb, 'number',   312,    298, true, 10),
  ('SSA',   'Collections this month',  'placeholder', null, null, null, 'all', '[]'::jsonb, 'currency', 156000, 171000, true, 20),
  ('SSA',   'Pending approvals',       'placeholder', null, null, null, 'all', '[]'::jsonb, 'number',   9,      14, false, 30),

  ('VISTA', 'Active projects',         'placeholder', null, null, null, 'all', '[]'::jsonb, 'number',   18,     16, true, 10),
  ('VISTA', 'Invoiced this month',     'placeholder', null, null, null, 'all', '[]'::jsonb, 'currency', 1250000, 980000, true, 20),
  ('VISTA', 'Completion rate',         'placeholder', null, null, null, 'all', '[]'::jsonb, 'percent',  76,     71, true, 30),

  -- SS Family: functions from the SS Family repo's 20261018090000_home_dashboard_metrics.sql,
  -- called with SS_FAMILY_DASHBOARD_KEY.
  ('SS_FAMILY', 'Guests at home today',  'rpc', 'home_dashboard_guests_now',      null, null, 'all', '[]'::jsonb, 'number', null, null, true,  10),
  ('SS_FAMILY', 'Visits next 30 days',   'rpc', 'home_dashboard_upcoming_visits', null, null, 'all', '[]'::jsonb, 'number', null, null, true,  20),
  ('SS_FAMILY', 'Open tasks',            'rpc', 'home_dashboard_open_tasks',      null, null, 'all', '[]'::jsonb, 'number', null, null, false, 30),
  ('SS_FAMILY', 'Dishes awaiting approval', 'rpc', 'home_dashboard_menu_pending', null, null, 'all', '[]'::jsonb, 'number', null, null, false, 40)
) as v(project, title, query_type, table_name, value_column, date_column, date_range, filter, format, sample_value, sample_previous, higher_is_better, sort_order)
where not exists (select 1 from public.dashboard_cards);


insert into public.dashboard_settings (key, value) values
  ('display_name', '"Salman"'::jsonb),
  ('currency', '"PKR"'::jsonb),
  ('google_calendar_embed_url', 'null'::jsonb)
on conflict (key) do nothing;

-- Add your login email here (lower case). Without a row in this table,
-- nobody — not even a signed-in user — can read or write the dashboard.
-- insert into public.dashboard_owners (email) values ('you@example.com');
