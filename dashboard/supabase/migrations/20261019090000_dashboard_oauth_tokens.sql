-- OAuth connections for the dashboard's own integrations (Google Calendar
-- now, Microsoft To Do later). Tokens are encrypted by the app with
-- TOKEN_ENCRYPTION_KEY before they reach this table, so the table never
-- holds a usable token on its own. Owner-only, like the other tables.

create table if not exists public.dashboard_oauth_tokens (
  provider text primary key check (provider in ('google', 'microsoft')),
  account_email text,
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists dashboard_oauth_tokens_touch on public.dashboard_oauth_tokens;
create trigger dashboard_oauth_tokens_touch before update on public.dashboard_oauth_tokens
  for each row execute function public.dashboard_touch_updated_at();

alter table public.dashboard_oauth_tokens enable row level security;

drop policy if exists "owner full access" on public.dashboard_oauth_tokens;
create policy "owner full access" on public.dashboard_oauth_tokens
  for all to authenticated
  using (public.is_dashboard_owner())
  with check (public.is_dashboard_owner());

revoke all on public.dashboard_oauth_tokens from anon;
grant select, insert, update, delete on public.dashboard_oauth_tokens to authenticated;
