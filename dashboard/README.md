# My Dashboard

A personal "home screen" for all my work: project icons, live KPI cards from
each project's own Supabase, Google Calendar, Microsoft To Do and family links.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase
(auth + settings) · Vercel. Responsive, light/dark mode.

This app lives in the `dashboard/` folder of the SS-FAMILY repo and is deployed
as its own Vercel project. It does not touch the SS Family app.

---

## What's on the page

| Section | What it does |
| --- | --- |
| Header | Greeting with your name, live date and time in Asia/Karachi, theme toggle, settings, sign out |
| My Projects | App-style icons (MBL, RMI, SSA, VISTA …). Tap → opens the project in a new tab |
| Reports | 3–5 KPI cards per project: big number, trend vs last month, last-updated time. Refresh button + auto-refresh every 5 minutes. A failing card shows its own error; the rest keep working |
| Personal | Mera, SS Family, Google Calendar, Microsoft To Do tiles, plus your Google Calendar embedded (agenda / week / month) |
| Settings | Name, currency, calendar URL · add / edit / delete / drag-to-reorder icons · add / edit / delete report cards |

## How it's put together

```
dashboard/
├── src/proxy.ts                   session refresh + email whitelist on every request
├── src/app/page.tsx               the dashboard
├── src/app/settings/              settings page + server actions
├── src/app/login/                 magic-link / code sign-in
├── src/app/auth/callback/         where the email link lands
├── src/app/api/cards/route.ts     GET /api/cards?project=RMI — computes card numbers on the server
├── src/lib/cards.ts               count / sum / rpc / placeholder card engine
├── src/lib/projects.ts            per-project Supabase clients from env vars
└── supabase/
    ├── migrations/                tables, RLS, seed data for the dashboard project
    └── project-examples/          SQL to run inside a project (e.g. RMI low-stock function)
```

**Security**

- Sign-in is Supabase email (magic link or 6-digit code) with
  `shouldCreateUser: false` — nobody can sign up.
- Two whitelists: `ALLOWED_EMAILS` (checked in `proxy.ts`, the login action,
  the auth callback and every server action) **and** the `dashboard_owners`
  table (checked by Row Level Security in the database).
- RLS is on for every dashboard table; anonymous users have no grants at all.
- No `NEXT_PUBLIC_` variables. Every Supabase URL and key — the dashboard's and
  each project's — is read on the server only. The browser only ever talks to
  this app's own routes.

---

## Setup

### 1. Create the dashboard's Supabase project

The dashboard's tables can live in a project of their own or in the `public`
schema of an existing project whose own data lives elsewhere. Either way the
project's Auth is used for the login, so don't change its Site URL or email
templates if another app depends on them — just add the dashboard's
`/auth/callback` to its Redirect URLs.

1. Pick or create the project.
2. **SQL Editor** → run, in order:
   - `supabase/migrations/20261017120000_dashboard_core.sql`
   - `supabase/migrations/20261017120100_dashboard_seed.sql`
3. Still in the SQL editor, whitelist yourself (lower case):
   ```sql
   insert into public.dashboard_owners (email) values ('you@example.com');
   ```
4. **Authentication → Users → Add user → Send invitation** (or "Create new
   user") with the same email. Sign-ups are never allowed from the app, so the
   user must exist first.
5. **Authentication → Sign In / Providers → Email**: enable Email. In a project
   of its own you can turn **Allow new users to sign up** off.
6. **Authentication → URL Configuration**:
   - Site URL (own project only): `https://your-dashboard.vercel.app`
   - Redirect URLs: add `https://your-dashboard.vercel.app/auth/callback` and
     `http://localhost:3000/auth/callback`
7. *(Own project only, recommended)* **Authentication → Emails → Magic Link** template — make the
   link work on any device and include the code:
   ```html
   <h2>Sign in to My Dashboard</h2>
   <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```
   With the default template the link still works, but only in the same
   browser you requested it from.
8. **Project Settings → API**: copy the Project URL and the anon / publishable
   key for the env vars below.

### 2. Run locally

```bash
cd dashboard
npm install
cp .env.example .env.local     # fill in the values
npm run dev                    # http://localhost:3000
```

### 3. Connect a project's reports (RMI example)

1. In the RMI Supabase project → Project Settings → API, copy the URL and a key.
   - **anon key**: the card queries run under RMI's RLS as an anonymous user,
     so you'll need policies/functions that allow those reads.
   - **service_role key**: reads past RLS. It stays on the server (never in the
     browser), but it is a powerful key — prefer the anon key plus small
     `security definer` functions if you're unsure.
2. Set `RMI_SUPABASE_URL` and `RMI_SUPABASE_ANON_KEY` (or
   `RMI_SUPABASE_SERVICE_ROLE_KEY`).
3. Open **Settings → Report cards** and fix each RMI card's table and column
   names to match the real RMI schema. The seeded guesses are:

   | Card | Type | Table / function | Column(s) | Period |
   | --- | --- | --- | --- | --- |
   | Total students | count | `students` (status = active) | date: `created_at` | all |
   | Fee collected today | sum | `fee_payments` | `amount`, date: `paid_on` | today |
   | Pending dues | sum | `fee_invoices` (balance > 0) | `balance` | all |
   | Low-stock items | rpc | `dashboard_low_stock_count` | — | — |
   | Payroll this month | sum | `payroll` | `net_pay`, date: `pay_date` | this month |

4. For low stock, run `supabase/project-examples/rmi_low_stock.sql` **in the
   RMI project** after adjusting its table names.

### How a card is computed

| `query_type` | Result |
| --- | --- |
| `count` | rows in `table_name` matching `filter` |
| `sum` | sum of `value_column` over matching rows |
| `rpc` | calls the function named in `table_name`; it returns a number or `{"value": n, "previous": n}` |
| `placeholder` | shows `sample_value` / `sample_previous` (marked **Sample**) |

`date_range` (in Asia/Karachi time) narrows `count`/`sum` by `date_column`
and sets what the trend compares against:

- `today` → vs the same day last month
- `this_month` → vs all of last month
- `all` → vs the total as it stood at the start of this month (needs `date_column`)

`filter` is a JSON array, e.g.
`[{"column":"status","op":"eq","value":"active"}]` — ops: `eq neq gt gte lt lte is in like ilike`.
Need anything fancier (joins, column-vs-column)? Write a function in that
project and use `rpc`.

MBL, SSA and VISTA start as placeholders. **TODO** for each: set its
`<PROJECT>_SUPABASE_URL` / key, then edit its cards in Settings to `count`,
`sum` or `rpc` with the real table names. To add a new project, add its icon,
add cards with the new project key (e.g. `ACME`) and set `ACME_SUPABASE_URL` +
`ACME_SUPABASE_ANON_KEY`. No code changes.

### 4. Connect SS Family

SS Family's tables only answer signed-in family members, and its anon key is
public (it ships in the SS Family web app). So its cards call four functions
that also require a shared secret:

1. In the **SS Family** Supabase project, run
   `supabase/migrations/20261018090000_home_dashboard_metrics.sql` from the
   repo root (or `supabase db push`).
2. Pick a long random secret and store its hash there (SQL editor):
   ```sql
   insert into public.home_dashboard_key (key_hash)
   values (encode(sha256(convert_to('<the secret>', 'UTF8')), 'hex'))
   on conflict (id) do update set key_hash = excluded.key_hash;
   ```
3. On Vercel set `SS_FAMILY_SUPABASE_URL`, `SS_FAMILY_SUPABASE_ANON_KEY` and
   `SS_FAMILY_DASHBOARD_KEY` (the secret itself, not the hash).

Cards: guests at home today, visits in the next 30 days, open tasks, and dishes
awaiting approval ("today" is Asia/Riyadh).

Any project can use the same pattern: when `<PROJECT>_DASHBOARD_KEY` is set,
its `rpc` cards pass it as the `p_key` argument.

### 5. Google Calendar (Phase 1)

Google Calendar → ⚙ Settings → your calendar → **Integrate calendar** → copy
the `src` URL from *Embed code* (`https://calendar.google.com/calendar/embed?src=…`)
→ paste into dashboard **Settings → General**.

A private calendar only shows in the embed while you're signed in to Google in
that browser (and some browsers block it as a third-party cookie). If it shows
"no access", either make the calendar public (free/busy only is enough) or wait
for Phase 2.

---

## Deploy on Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. vercel.com → **Add New → Project** → import `SS-FAMILY`.
3. **Root Directory: `dashboard`** (important — the repo root is the SS Family app).
   Framework preset: Next.js (auto-detected). Leave build settings as default.
4. **Environment Variables**: add everything from `.env.example` that you use
   (at least `DASHBOARD_SUPABASE_URL`, `DASHBOARD_SUPABASE_ANON_KEY`,
   `ALLOWED_EMAILS`, `SITE_URL`, and `RMI_…`).
5. Deploy. Then put the production URL into Supabase → Authentication → URL
   Configuration (Site URL + `/auth/callback` redirect) and into `SITE_URL`.

Changing an env var on Vercel needs a redeploy to take effect.

---

## Phase 2 — what's needed

### Google Calendar API ("Today" and "Next 7 days" cards)

1. Google Cloud Console → new project → enable **Google Calendar API**.
2. OAuth consent screen: External, add yourself as a test user, scope
   `https://www.googleapis.com/auth/calendar.readonly`.
3. Credentials → OAuth client ID (Web) with redirect URI
   `https://your-dashboard.vercel.app/api/google/callback`.
4. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`.
5. Code to add: `/api/google/connect` + `/api/google/callback` (OAuth with
   `access_type=offline`), an encrypted `dashboard_oauth_tokens` table (RLS like
   the others), and `/api/calendar` returning today's and next-7-days events
   (`events.list` with `timeMin`/`timeMax`, `singleEvents=true`,
   `timeZone=Asia/Karachi`).

### Microsoft To Do (Microsoft Graph)

1. Azure portal → **App registrations → New registration**; account type
   "Personal Microsoft accounts" (or work + personal if To Do is on a work account).
2. Redirect URI (Web): `https://your-dashboard.vercel.app/api/microsoft/callback`.
3. API permissions → Microsoft Graph → Delegated: `Tasks.ReadWrite`
   (`Tasks.Read` is enough to list, but marking a task done needs ReadWrite),
   plus `offline_access` and `User.Read`.
4. Certificates & secrets → new client secret.
5. Env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
   (`consumers` for a personal account, `common` for both).
6. Code to add: connect/callback routes, token storage in the same table,
   `/api/todo` (`GET /me/todo/lists`, then
   `GET /me/todo/lists/{id}/tasks?$filter=status ne 'completed'`) and a
   "mark done" route (`PATCH …/tasks/{id}` with `{"status":"completed"}`).
