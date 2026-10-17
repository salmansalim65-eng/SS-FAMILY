# SS Family — Guest Management & Event Planning System

A working web application for managing family visits from Pakistan to Saudi Arabia:
guests, menu planning with an approval workflow, task assignment, a consolidated
shopping list for the driver, and notifications throughout.

Built on **React + Vite + TypeScript + Tailwind** with **Supabase** (Postgres, Auth,
Row Level Security, Edge Functions) as the backend. Not a mockup — every screen reads
and writes a live database, and the workflow rules are enforced in the database itself.

> **Personal dashboard:** the `dashboard/` folder holds a separate Next.js app —
> a home screen for all projects. See [`dashboard/README.md`](dashboard/README.md).

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

**Edit** on any row reopens all of that — name, relation, username, phone,
WhatsApp number, role, and whether they can approve menus. Changing a username
moves the login with it, because the sign-in address is derived from the
username; that is done first, so a clash or a rejected name leaves the account
exactly as it was and the person can still sign in with their old one.

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
| Dashboard, guests, menu | ✅ full | ✅ view + suggest | ❌ |
| Tasks | ✅ all | ✅ all | only their own |
| Approve / reject menu items | ✅ | only if ticked | ❌ |
| Their own dish needs approval | no | yes, unless ticked | — |
| Create & assign tasks | ✅ | ❌ | ❌ |
| Update status of own task | ✅ | ✅ | ❌ |
| Add shopping items | ✅ | ✅ | ❌ |
| See **their own** shopping items | ✅ | ✅ | — |
| See **everyone's** shopping items | ✅ | ❌ | sent items only |
| Mark items purchased | ✅ | ✅ | ✅ |
| Edit accounts, change roles | ✅ | ❌ | ❌ |

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

member dish stays a draft                     draft
member cannot self-approve a dish             blocked
member cannot approve their own draft         blocked
approver's dish is approved on the spot       approved
approver can approve a member draft           approved
driver cannot see an unsent basket            0 rows
another member cannot see it either           0 rows
the head can see everything                   3 rows
driver sees the basket once sent              3 rows
one notification per basket, not per item     1
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

A dish suggested by an **approver** goes straight on the menu; anyone else's is saved
as `DRAFT` and waits. Approvers are the head of family plus whoever they tick
**Can approve menus** for in Settings — in practice, the wife. That flag is the only
difference: it does not make them head, and it does not touch anything but the menu.

Either way, the moment a dish is approved a database trigger:

- creates a task — `Cook <dish>` for homemade items, `Buy <dish>` for outside ones,
- assigns it to the cook (or to the person responsible for buying it),
- names the restaurant in the task description when the dish is ordered in,
- sets the due date to the serve date, raising priority to high if that is within a day,
- notifies the suggester, the cook and the head.

An outside dish must say **which restaurant or shop**, because whoever picks it up
needs to know where to go. The name shows on the card, in the task, in the WhatsApp
share, and is offered as a suggestion next time.

When the cook later marks the task complete, the menu item follows it to `COMPLETED`.
Moving a task to *in progress* moves the dish to *in progress* too.

### 3 · Basket → send → the driver's list

Shopping works like ordering online. Everything you tick lands in **your basket**,
which is yours alone — no other family member can see it, and neither can the driver.
You set the quantities and say which shop each thing comes from, then press **Send to
driver** and the whole lot goes at once, as one notification rather than one per tick.

A member sees only their own items, ever. The head sees everything; the driver sees
everything that has been sent.

Once sent, the driver reads the same items three ways, because the answer they need
changes through the trip:

```
By shop            Merged totals            By person
🏪 Panda           Chicken   3 kg  Panda    👤 Ahmed
  Chicken 1 kg     Onions    2 kg  Othaim     Chicken 1 kg — Panda
    (Ahmed)        Eggs      2 dz  Bindawood  Eggs    2 dz — Bindawood
  Chicken 2 kg                                👤 Hassan
    (Hassan)                                   Chicken 2 kg — Panda
```

Merging is per shop, deliberately: chicken from Panda and chicken from Othaim are two
different errands, so they stay two lines. Same item, same shop, same unit becomes one.

The add-item form also warns about near-duplicates while you type, using trigram
similarity — typing `chiken` finds the existing `Chicken` entries.

### 4 · The stay plan

A dinner guest needs a menu. A guest who moves in for a week needs rather more, and
remembering all of it every time is how things get missed. So adding a **staying**
guest lays the whole visit out as dated tasks — a plan the household edits once and
then simply follows.

```
🧹 Before they arrive   deep clean · fresh linen · towels and toiletries
                        snack bar · room check (AC, WiFi, iron, prayer mat)
                        confirm the pickup · plan the menu
🤝 Arrival day          welcome tray of dates and qahwa · show them around
🕌 Every day            Haram pick & drop (Masjid an-Nabawi)
🍽️ Every day            breakfast · lunch · dinner · evening tea and something
                        sweet · tidy the room · refill water
🧺 Every few days       fresh towels (2) · laundry (3) · change the linen (4)
👋 Departure day        pack snacks for the journey · check for forgotten things
                        farewell gift · drop them to the airport
🔄 After they go        strip the beds · reset the room for next time
```

Three details make it usable rather than overwhelming:

- **One notification, not sixty.** A week-long stay is around 60 tasks. Creating them
  sets a flag that stands the per-task assignment notice down, and a single summary
  goes out instead.
- **Nothing repeats pointlessly.** Laundry starts three days *in*, not on arrival day
  when it was just done; a one-night visit skips laundry and linen changes entirely.
- **Editing dates rebuilds, never duplicates.** Change the departure date and the plan
  reshapes around it — but any job already marked done is left exactly as it is.

The Haram run leads the daily list, because for a guest in Madinah it is the
point of the visit. It is the driver's job, so a driver can now reach Tasks and
see the ones assigned to them — and nothing else: no guest list, no menu, no
household chores.

**Guests → Stay plan** is where the household's standard lives: turn items off, add
your own, and say who normally does each one so they are assigned the moment a guest
is added. Each staying guest's card then carries its own progress — `🏠 Stay plan
9/56` — and opens day by day, so it is obvious at a glance whether tomorrow is
covered.

Cancel the visit, or turn it into a dinner, and the outstanding work disappears with
it.

### 5 · The grocery list

Family members do not have to type anything. The **Grocery** tab shows the standing
catalogue — 98 items across 12 categories — and you tick what you need:

```
🥬 Vegetables        Onions      ✓  2 kg   − +
                     Tomatoes       2 kg
🥩 Meat              Chicken     ✓  1 kg   − +
```

A tick drops the item in your basket with its usual shop already filled in — eggs
from Bindawood, chicken from Panda — which you can change per item before sending.
Missing something? "+ Add item" still takes a free-text entry, and the head can add it
to the catalogue for next time.

### 6 · Reminders

The `reminders` edge function notifies assignees **1 day before** a task is due, the
family **3 days before** a staying guest arrives and **1 day before** a dinner guest.
`pg_cron` runs it every day at **15:00 Saudi time** (12:00 UTC). It is idempotent, so
a retry or a double run is harmless.

Check the schedule and the last few runs with:

```sql
select jobname, schedule, active from cron.job;
select status_code, content from net._http_response order by id desc limit 5;
```

### 7 · Guest history

Every visit stays in `guests`. `guest_profiles` is the rolled-up record of one guest
across all of them — how often they have come, how many nights, the room they usually
take — and it is maintained by a trigger, so it is never stale.

One field is deliberately **not** derived: `notes`. That is where the family writes
what it has learned ("prefers the ground-floor room", "no chilli"), and the sync never
touches it. Open **Guests → History** to read it before the next visit.

### 8 · Recurring chores

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
                  GroceryPicker, BasketPanel, DriverList, GuestHistory,
                  StayPlanEditor, GuestStayPlan, ChoresPanel, PushPanel,
                  ShareButton, ErrorBoundary
  context/        AuthContext (session + role), ToastContext
  lib/            supabase client, types, formatting + colour coding,
                  Google Calendar / .ics, CSV export, web push, WhatsApp links
public/         service worker, web app manifest, icons
supabase/
  migrations/     schema → logic → security → hardening → username accounts
                  → guest types → reminders cron → guest profiles
                  → recurring chores → grocery catalogue → web push
                  → approvals and baskets → stay plan
  functions/      admin-users, google-calendar, send-push, reminders
  seed.sql        bootstrap the ss head-of-family account
```

### Database

| Table | Purpose |
| --- | --- |
| `users` | profile mirrored from `auth.users`: username, relation, role, menu approver |
| `guests` | visits, with male/female counts, room, special needs, calendar event id |
| `menu_items` | dish, status workflow, cook, homemade/outside, quantity, cost |
| `tasks` | manual, menu-generated and stay-plan tasks: priority, due date, status |
| `stay_plan_templates` | what the household always does for a guest who sleeps here |
| `shopping_list` | one row per request: which shop, and `submitted_at` once sent |
| `grocery_catalogue` | the standing tick-list, by category, with default quantities |
| `guest_profiles` | one row per guest: visit counts, nights, remembered preferences |
| `recurring_tasks` | chore templates that generate real tasks when due |
| `notifications` | in-app inbox plus the push delivery queue |
| `push_subscriptions` | one row per device, so a phone and a laptop both get alerts |
| `activity_log` | who did what and when |

Plus the `shopping_consolidated`, `shopping_for_driver` and `guest_visits` views,
and the RPCs
`dashboard_stats`, `find_similar_shopping_items`, `set_shopping_status`,
`mark_all_notifications_read`, `generate_recurring_tasks`, `submit_my_basket`.

Three `pg_cron` jobs keep the place running unattended: `ss-family-daily-reminders`
(12:00 UTC = 15:00 Riyadh), `ss-family-recurring-chores` (03:10 UTC = 06:10 Riyadh,
so the day's chores exist before anyone is up) and `ss-family-push-drain` (every
minute).

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

**Phone notifications** — the app pushes its own

```
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
VAPID_SUBJECT             # optional, a mailto: identifying the sender
```

Generate a pair with `npx web-push generate-vapid-keys`. The public half also
goes in `.env.production` as `VITE_VAPID_PUBLIC_KEY` — it is public by design,
the browser needs it to subscribe. The private half never leaves Supabase.

`ss-family-push-drain` empties the queue every minute, and the 15:00 reminder
run pushes its own batch immediately rather than waiting. A subscription that
the push service reports as gone (404/410) is deleted on the spot, so a
reinstalled browser never leaves a dead device behind.

Each person turns notifications on once per device in **Settings → Phone
notifications**, which also lists their registered devices and can send a test.
On iPhone and iPad there is one extra step: Apple only grants the Push API to a
web app added to the Home Screen (Share → Add to Home Screen), and the panel
says so rather than offering a button that would quietly do nothing.

### Why not WhatsApp?

An application cannot send a WhatsApp message. Meta only allows it through the
WhatsApp Business API or a reseller such as Twilio, which means business
verification, per-message fees, and a rule that free-form text is delivered
only within 24 hours of the recipient's last message — precisely the window a
3pm reminder falls outside.

So the app does the honest version instead. **ShareButton** puts a one-tap
"open WhatsApp with this message already written" link on a guest, a task, the
menu and the shopping list; you pick the family group and press send. No
account, no fees, no 24-hour rule — and the automatic alerts go out as push
notifications, which arrive whether or not anyone has messaged anything.

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
