"use client";

import { useState } from "react";
import { assignTaskByEmail, cancelInvite } from "@/app/sstasks/actions";

// Task Hub invites shown on the dashboard: the join link for someone not in
// Task Hub yet, and "Assign by email" (used in the task menu and the task panel).

export function InviteLink({ appUrl, token, email, onCancelled }: { appUrl: string; token: string; email: string; onCancelled?: () => void }) {
  const link = `${appUrl.replace(/\/$/, "")}/join/${token}`;
  const [copied, setCopied] = useState(false);
  const [cancelled, setCancelled] = useState<string | null>(null);
  if (cancelled) return <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted">{cancelled}</p>;
  return (
    <div className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
      <p>
        <b>{email}</b> is not in Task Hub yet. Send them this link — it is theirs as soon as they join:
      </p>
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg" />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {}
          }}
          className="rounded-md bg-accent px-2 py-0.5 font-medium text-white"
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`You've been added to Task Hub. Join here: ${link}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-line px-2 py-0.5 text-fg hover:bg-surface"
        >
          WhatsApp
        </a>
        <button
          type="button"
          onClick={async () => {
            if (!confirm(`Cancel the invite for ${email}? The link will stop working.`)) return;
            const res = await cancelInvite(token);
            if (!res.ok) return alert(res.error);
            setCancelled(`Invite for ${email} cancelled — the link no longer works.`);
            onCancelled?.();
          }}
          className="ml-auto rounded-md border border-danger/40 px-2 py-0.5 text-danger hover:bg-danger-soft"
        >
          ✕ Cancel invite
        </button>
      </div>
    </div>
  );
}

export type Msg = { ok: string } | { error: string } | { invite: { token: string; email: string } } | null;

/** "Assign by email" inside the task menu. */
export function AssignByEmail({ taskId, appUrl, onAssigned }: { taskId: string; appUrl: string; onAssigned: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const res = await assignTaskByEmail(taskId, email);
    setBusy(false);
    if (!res.ok) return setMsg({ error: res.error });
    if (res.data.status === "assigned") {
      setMsg({ ok: `Assigned to ${res.data.name}${res.data.added ? " (added to this project)" : ""}.` });
      setEmail("");
    } else setMsg({ invite: { token: res.data.token, email: res.data.email } });
    onAssigned();
  }
  return (
    <div className="space-y-1.5">
      <form onSubmit={submit} className="flex gap-1">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Assign by email…" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs" />
        <button type="submit" disabled={busy || !email.trim()} className="rounded-lg bg-accent px-2 text-xs font-medium text-white disabled:opacity-50">
          {busy ? "…" : "Assign"}
        </button>
      </form>
      {msg && "ok" in msg && <p className="text-xs text-up">{msg.ok}</p>}
      {msg && "error" in msg && <p className="text-xs text-danger">{msg.error}</p>}
      {msg && "invite" in msg && <InviteLink appUrl={appUrl} token={msg.invite.token} email={msg.invite.email} />}
    </div>
  );
}
