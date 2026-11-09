-- Where a card opens when clicked: a path in the project's own app (joined
-- to its icon's URL, e.g. /reports/cash-book) or a full https:// URL.
alter table public.dashboard_cards add column if not exists link text
  check (link is null or link ~ '^(/|https?://)');
