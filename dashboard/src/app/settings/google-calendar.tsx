"use client";

import { disconnectGoogleCalendar } from "./actions";
import { Status, dangerBtn, primaryBtn, useAction } from "./ui";

const RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Calendar connected." },
  denied: { ok: false, text: "Google access was not granted." },
  state_mismatch: { ok: false, text: "The sign-in expired or came from another tab. Try connecting again." },
  no_code: { ok: false, text: "Google did not send a sign-in code. Try again." },
  failed: { ok: false, text: "Connecting failed. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY on Vercel, and the redirect URI in Google Cloud." },
};

export function GoogleCalendarSettings({
  connection,
  result,
}: {
  connection: { account_email: string | null; connected_at: string; canWrite: boolean } | null;
  result?: string;
}) {
  const disconnect = useAction();
  const banner = result ? RESULTS[result] : undefined;

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      {banner && (
        <p className={`rounded-xl px-3 py-2 text-sm ${banner.ok ? "bg-surface-2 text-up" : "bg-danger-soft text-danger"}`}>{banner.text}</p>
      )}
      {connection ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Connected</p>
            <p className="text-sm text-muted">{connection.account_email ?? "Google account"}</p>
            {!connection.canWrite && (
              <p className="mt-1 text-sm text-danger">View only. Reconnect once to allow adding events from the dashboard.</p>
            )}
          </div>
          <div className="flex gap-2">
            <a href="/api/google/connect" className="rounded-xl border border-line px-4 py-2 text-sm hover:bg-surface-2">Reconnect</a>
            <button
              type="button"
              className={dangerBtn}
              disabled={disconnect.pending}
              onClick={() => confirm("Disconnect Google Calendar?") && disconnect.exec(disconnectGoogleCalendar)}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Not connected.</p>
          <a href="/api/google/connect" className={primaryBtn}>Connect Google Calendar</a>
        </div>
      )}
      <Status error={disconnect.error} />
    </div>
  );
}
