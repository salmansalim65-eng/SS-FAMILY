# SS Family — Guest Management & Event Planning System

A working web application for managing family visits from Pakistan to Saudi Arabia:
guests, menu planning with an approval workflow, task assignment, a consolidated
shopping list for the driver, and notifications throughout.

Built on **React + Vite + TypeScript + Tailwind** with **Supabase** (Postgres, Auth,
Row Level Security, Edge Functions) as the backend. Not a mockup — every screen reads
and writes a live database, and the workflow rules are enforced in the database itself.

---

## Quick start

```bash
npm install
cp .env.example .env      # already points at the live SS-FAMILY Supabase project
npm run dev               # http://localhost:5173
```

### Signing in

People sign in with a **username and password**. No email, and there is no
public sign-up — the head of family creates every account from inside the app.

The bootstrap administrator is:

| Username | Password | Role |
| --- | --- | --- |
| `ss` | `admin123` | Head of Family |

> Change that password on first sign-in: **Settings → Change my password**.

### Adding people

Sign in as the head, then **Settings → User management → + Add user**. You give
each person a full name, relation, username, password and role; they sign in
with that username and can change their own password afterwards.

Supabase Auth needs an email internally, so each account carries a synthetic
one — `<username>@ssfamily.local`. Nobody ever sees or types it. The format
lives in three places that must agree: `login_email()` in the database,
`loginEmail()` in `src/context/AuthContext.tsx`, and `EMAIL_DOMAIN` in the
`admin-users` edge function.

Creating accounts, resetting someone else's password and deleting accounts all
need the service role, so they run in the `admin-users` edge function, which
checks the caller's JWT *and* that their profile says `role = 'head'`.

Supabase's sign-up endpoint stays reachable at the API level, so the real gate
is in the database: `handle_new_user()` only writes a profile row for accounts
carrying the admin flag. A self-registered account therefore has no profile,
which makes `app_role()` null and every RLS policy deny it — the account exists
but can see and do nothing.

---

## Roles

| | Head of Family | Family Member | Driver |
| --- | :---: | :---: | :---: |
| Dashboard, guests, menu, tasks | ✅ full | ✅ view + suggest | ❌ |
| Approve / reject menu items | ✅ | ❌ | ❌ |
| Create & assign tasks | ✅ | ❌ | ❌ |
| Update status of own task | ✅ | ✅ | ❌ |
| Add shopping items | ✅ | ✅ | ❌ |
| See consolidated shopping list | ✅ | ✅ | ✅ |
| Mark items purchased | ✅ | ✅ | ✅ |
| Change anyone's role | ✅ | ❌ | ❌ |

These are not just hidden buttons. Every rule is enforced by Postgres row level
security and guard triggers, so a member cannot approve a menu item or a driver read
the guest list even by calling the API directly. Verified against the live database:

```
driver can read                  guests=0 menu=0 tasks=0 shopping_lines=8
driver adds shopping item        BLOCKED - new row violates row-level security policy
member approves menu             BLOCKED - Only the head of family can approve or reject menu items
member creates task              BLOCKED - new row violates row-level security policy
member suggests draft dish       ALLOWED
member self-promotes to head     BLOCKED - Only the head of family can change roles
head approves menu               ALLOWED
```

---

## The workflows

### 1 · A guest is added

Head or member fills in the guest form → the row is saved → a trigger notifies every
family member → the dashboard starts counting down. On save the app also asks the
`google-calendar` edge function to create an all-day event with a reminder **3 days
before arrival**. If Google is not connected, each guest card still offers a one-click
**Add to Calendar** link and an **.ics** download that carries the same 3-day alarm.

### 2 · Menu suggestion → approval → automatic task

Anyone suggests a dish; it is saved as `DRAFT` and is visible to all. Only the head can
approve. On approval a database trigger:

- creates a task — `Cook <dish>` for homemade items, `Buy <dish>` for outside ones,
- assigns it to the cook (or to the person responsible for buying it),
- sets the due date to the serve date, raising priority to high if that is within a day,
- notifies the suggester, the cook and the head.

When the cook later marks the task complete, the menu item follows it to `COMPLETED`.
Moving a task to *in progress* moves the dish to *in progress* too.

### 3 · Shopping list consolidation

Everyone adds what they need, independently. The `shopping_consolidated` view groups
by normalised item name + unit + category and sums the quantities, so the driver gets
one line per item while each person keeps credit for their request:

```
Fatima  adds  Basmati Rice  2 kg
Ahmed   adds  Chicken       1 kg
Hassan  adds  Chicken       2 kg
                    ↓
Driver sees:  Chicken 3 kg  (merged from 2 requests · Ahmed, Hassan)
              Basmati Rice 2 kg
```

The add-item form also warns about near-duplicates while you type, using trigram
similarity — typing `chiken` finds the existing `Chicken` entries.

### 4 · The grocery list

Family members do not have to type anything. The **Grocery** tab shows the standing
catalogue — 98 items across 12 categories — and you tick what you need:

```
🥬 Vegetables        Onions      ✓  2 kg   − +
                     Tomatoes       2 kg
🥩 Meat              Chicken     ✓  1 kg   − +
```

A tick writes an ordinary `shopping_list` row owned by you, so it merges into the
driver's consolidated list exactly like a typed-in item. The driver opens the same
page and sees one totalled line per item. Missing something? "+ Add item" still takes
a free-text entry, and the head can add it to the catalogue for next time.

### 5 · Reminders

The `reminders` edge function notifies assignees **1 day before** a task is due, the
family **3 days before** a staying guest arrives and **1 day before** a dinner guest.
`pg_cron` runs it every day at 03:00 UTC (06:00 in Riyadh). It is idempotent, so a
retry or a double run is harmless.

Check the schedule and the last few runs with:

```sql
select jobname, schedule, active from cron.job;
select status_code, content from net._http_response order by id desc limit 5;
```

### 6 · Guest history

Every visit stays in `guests`. `guest_profiles` is the rolled-up record of one guest
across all of them — how often they have come, how many nights, the room they usually
take — and it is maintained by a trigger, so it is never stale.

One field is deliberately **not** derived: `notes`. That is where the family writes
what it has learned ("prefers the ground-floor room", "no chilli"), and the sync never
touches it. Open **Guests → History** to read it before the next visit.

### 7 · Recurring chores

A chore is a template, not a task: title, assignee, priority, and a frequency of
daily, weekly (pick the weekday) or monthly (pick the day, 1–28, so it never skips a
short month). A nightly job at 03:10 UTC turns each one into a real row in `tasks`
when it falls due, which means chores inherit the same assignment, notification,
reminder and completion handling as everything else.

A chore that has been dormant for months produces **one** task, not a backlog. Pause
one at any time; the head can also press "Run now" to generate immediately.

---

## Project layout

```
src/
  pages/          Login, Dashboard, Guests, Menu, Tasks, Shopping,
                  Notifications, Activity, Settings
  components/     Layout (sidebar + mobile bottom nav), NotificationBell, ui.tsx,
                  GroceryPicker, GuestHistory, ChoresPanel, ErrorBoundary
  context/        AuthContext (session + role), ToastContext
  lib/            supabase client, types, formatting + colour coding,
                  Google Calendar / .ics, CSV export
supabase/
  migrations/     schema → logic → security → hardening → username accounts
                  → guest types → reminders cron → guest profiles
                  → recurring chores → grocery catalogue
  functions/      admin-users, google-calendar, send-whatsapp, reminders
  seed.sql        bootstrap the ss head-of-family account
```

### Database

| Table | Purpose |
| --- | --- |
| `users` | profile mirrored from `auth.users`: username, relation, role |
| `guests` | visits, with male/female counts, room, special needs, calendar event id |
| `menu_items` | dish, status workflow, cook, homemade/outside, quantity, cost |
| `tasks` | manual and menu-generated, priority, due date, status |
| `shopping_list` | one row per request, with a generated `normalized_name` |
| `grocery_catalogue` | the standing tick-list, by category, with default quantities |
| `guest_profiles` | one row per guest: visit counts, nights, remembered preferences |
| `recurring_tasks` | chore templates that generate real tasks when due |
| `notifications` | in-app inbox plus the WhatsApp delivery queue |
| `activity_log` | who did what and when |

Plus the `shopping_consolidated` and `guest_visits` views, and the RPCs
`dashboard_stats`, `find_similar_shopping_items`, `set_shopping_status`,
`mark_all_notifications_read`, `generate_recurring_tasks`.

Two `pg_cron` jobs keep the place running unattended: `ss-family-daily-reminders`
(03:00 UTC) and `ss-family-recurring-chores` (03:10 UTC).

Colour coding is consistent throughout: **red** urgent/overdue, **amber** medium,
**green** completed, **blue** in progress, **grey** draft/pending, **violet** approved.

---

## Optional integrations

Everything above works with no extra setup. These add the external deliveries.

Set the secrets on the Supabase project (Dashboard → Edge Functions → Secrets, or
`supabase secrets set KEY=value`):

**Google Calendar** — real events on the family calendar

```
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
GOOGLE_CALENDAR_ID        # optional, defaults to "primary"
```

**WhatsApp via Twilio** — notification delivery

```
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
```

A notification is queued for WhatsApp only when its recipient has a WhatsApp number
saved in Settings. Until Twilio is configured, queued rows are marked *not configured*
in the inbox rather than silently disappearing. The seed deliberately leaves WhatsApp
numbers blank so nothing is ever sent to a placeholder number — add your own in
**Settings → My profile**.

**Daily reminders** — schedule the function once a day, e.g. with pg_cron:

```sql
select cron.schedule(
  'ss-family-reminders', '0 5 * * *',
  $$select net.http_post(
      url := 'https://<project>.supabase.co/functions/v1/reminders',
      headers := '{"Content-Type":"application/json"}'::jsonb
  )$$
);
```

Set a `CRON_SECRET` secret and send it as an `x-cron-secret` header to restrict who
can trigger it.

---

## Deploying

```bash
npm run build        # -> dist/
```

`dist/` is a static bundle; host it anywhere (Vercel, Netlify, Supabase Storage). Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's environment.

Applying the database to a different Supabase project:

```bash
supabase link --project-ref <ref>
supabase db push                      # runs supabase/migrations in order
psql "$DATABASE_URL" -f supabase/seed.sql
supabase functions deploy admin-users google-calendar send-whatsapp reminders
```

---

## Notes

- The publishable Supabase key in `.env.example` is safe to expose — it is designed for
  browsers and grants nothing on its own, because every table is behind row level
  security and requires a signed-in user.
- `products` and `orders` are leftovers from an unrelated scaffold that predates this
  app. They are empty, unused, and left untouched.
- Supabase's *leaked password protection* is off on this project. Turning it on
  (Dashboard → Authentication → Policies) is worth doing before real accounts exist;
  it can only be changed from the dashboard.
- The shopping list prints cleanly (`🖨 Print`) as a checkbox sheet grouped by
  category, and the guest list exports to CSV with a UTF-8 BOM so Urdu and Arabic names
  survive Excel.
