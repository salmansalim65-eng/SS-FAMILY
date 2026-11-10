# SS Tasks

Projects, shared tasks and assigned tasks for every company (SSA, RMI, MBL,
VISTA…), with guests from outside the team — like Teams + Planner.

- **Next.js 16** (App Router) + Tailwind v4, deployed on Vercel from the
  `tasks/` folder of this repo.
- **Supabase** project "TASK MANAGEMENT" (free organization). Schema:
  `supabase/migrations/`. Every table is behind Row Level Security:
  owners / admins / members see every project of their workspace; guests see
  only the projects they were added to.
- Accounts are made only from invite links (`/join/<token>`); a sign-up
  without an open invitation is refused by the database.

## Environment (Vercel)

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the project's API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's publishable (anon) key |

In Supabase → Authentication → Sign In / Providers → Email, turn **Confirm
email** off: sign-ups are already limited to invited emails, and the free
plan's built-in email can't reach outside addresses.
