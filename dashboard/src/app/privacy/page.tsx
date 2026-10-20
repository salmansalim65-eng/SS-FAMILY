import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · My Dashboard" };

// Public page: Google's OAuth consent screen needs a privacy policy link.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10 text-sm leading-relaxed sm:px-6">
      <div>
        <Link href="/" className="text-muted hover:text-fg">← My Dashboard</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Privacy policy</h1>
      </div>

      <p>
        My Dashboard is a private, single-user dashboard. Only its owner can sign in; there is no public sign-up and no
        other users.
      </p>

      <h2 className="pt-2 text-base font-semibold">Google Calendar</h2>
      <p>
        When the owner connects Google Calendar, the dashboard asks for access to read calendars
        (<code>calendar.readonly</code>), to add events (<code>calendar.events</code>) and for the account’s email
        address. It uses these only to show the owner’s own events in a week and schedule view, and to add an event when
        the owner fills in the “New event” form. It never changes or deletes existing events on its own, and it does not
        share, sell or send calendar data to anyone.
      </p>
      <p>
        The Google refresh token is stored encrypted in the dashboard’s database. Event details are fetched on demand and
        are not stored. The connection can be removed at any time from Settings → Google Calendar → Disconnect, which also
        revokes it at Google, or from the Google Account’s third-party access page.
      </p>

      <h2 className="pt-2 text-base font-semibold">Other data</h2>
      <p>
        The dashboard stores the owner’s settings, shortcuts and notes, and shows figures read from the owner’s own
        business systems. None of it is shared with third parties.
      </p>

      <p className="text-muted">Use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
    </main>
  );
}
