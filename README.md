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
`pg_cron` runs it every day at **15:00 Saudi time** (12:00 UTC). It is idempotent, so
a retry or a double run is harmless.

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
short month). A nightly job at 06:10 Riyadh time turns each one into a real row in
`tasks` when it falls due, which means chores inherit the same assignment, notification,
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

Three `pg_cron` jobs keep the place running unattended: `ss-family-daily-reminders`
(12:00 UTC = 15:00 Riyadh), `ss-family-recurring-chores` (03:10 UTC = 06:10 Riyadh,
so the day's chores exist before anyone is up) and `ss-family-whatsapp-drain` (every
5 minutes).

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
TWILIO_CONTENT_SID        # optional but see the 24-hour rule below
```

A notification is queued for WhatsApp only when its recipient has a number saved in
**Settings → My profile**. `ss-family-whatsapp-drain` empties the queue every 5
minutes, and the 15:00 reminder run pushes its own batch immediately rather than
waiting. A failed send is retried up to 3 times; anything older than 24 hours is
retired unsent, because a stale reminder is worse than none. Until Twilio is
configured, queued rows are marked *not configured* in the inbox rather than
silently disappearing.

Head of family: **Settings → Test WhatsApp** sends yourself one message right now,
which is the quickest way to find out whether the credentials work.

### The 24-hour rule

This is WhatsApp's rule, not Twilio's, and it catches everyone out. You may send
**free-form** text only within 24 hours of that person's last message to you.
Outside that window only a **pre-approved template** is delivered — Twilio rejects
the rest with error 63016, which the inbox shows verbatim.

So a 3pm reminder to someone who has not messaged the number today will *not* arrive
as free-form text. Two ways through:

| | Setup | Free-form | Reminders outside 24h |
| --- | --- | --- | --- |
| **Twilio sandbox** | minutes, free — each person sends `join <code>` once | ✅ for 24h after they message | ❌ |
| **WhatsApp sender** | Meta business verification + your own approved template | ✅ | ✅ |

For a production sender, create a Content template with two variables, then set
`TWILIO_CONTENT_SID`. Every message then goes out as that template with `{{1}}` = the
notification title and `{{2}}` = its body, so reminders arrive whatever the window.

Note that `send-whatsapp` runs with `verify_jwt` off so pg_cron can reach it. Calling
it only delivers messages that were already queued for family members' own numbers,
and each is sent once, so an unwanted caller can hurry the queue along but cannot put
anything new into it. The `test` action is the exception and does check the caller's
JWT and head-of-family role.

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
