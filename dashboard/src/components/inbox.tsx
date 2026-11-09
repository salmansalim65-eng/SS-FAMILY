"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { actOnInboxItem, readInboxAlert } from "@/app/inbox/actions";
import type { InboxAlert, InboxAuthorization, InboxSection } from "@/lib/inbox";
import { onDashboardRefresh } from "@/lib/refresh-event";
import { AppGlyph } from "./app-icon";

// 🔔 in the top strip: SS's approvals and alerts from SSA, RMI and MBL.
// SSA and RMI documents can be approved here; MBL opens MBL (its own sign-in
// and MFA). New items also ring as browser notifications.

const REFRESH_MS = 2 * 60 * 1000;
const SEEN_KEY = "dashboard.inboxSeen";

// The extra action each project offers beside Approve / Reject.
const EXTRA: Record<string, { action: string; label: string } | undefined> = {
  RMI: { action: "suspend", label: "Suspend" },
  SSA: { action: "send_back", label: "Send back" },
};

const amountFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Karachi" });

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return dateFmt.format(new Date(iso));
}

/** Rings a browser notification for items not seen in this browser before (not on the very first load). */
function notifyNew(sections: InboxSection[]) {
  const keys = sections.flatMap((s) => [
    ...s.authorizations.map((a) => ({ key: `${s.project}:a:${a.id}`, title: `Approval needed · ${s.name}`, body: a.label })),
    ...s.alerts.map((a) => ({ key: `${s.project}:n:${a.id}`, title: `${s.name}: ${a.title}`, body: a.body ?? "" })),
  ]);
  let seen: string[] | null = null;
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    seen = raw ? JSON.parse(raw) : null;
  } catch {}
  const fresh = seen ? keys.filter((k) => !seen!.includes(k.key)) : [];
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    for (const k of fresh.slice(0, 5)) {
      try {
        const n = new Notification(`🔔 ${k.title}`, { body: k.body, tag: k.key, icon: "/logos/ss-dashboard-512.png" });
        n.onclick = () => window.focus();
      } catch {}
    }
  }
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys.map((k) => k.key).slice(-500)));
  } catch {}
}

export function InboxBell() {
  const [sections, setSections] = useState<InboxSection[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSections(body.sections);
      setFailed(null);
      notifyNew(body.sections);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    load();
    const t = setInterval(load, REFRESH_MS);
    const off = onDashboardRefresh(load);
    return () => {
      clearInterval(t);
      off();
    };
  }, [load]);

  const approvals = sections?.reduce((n, s) => n + s.authorizations.length, 0) ?? 0;
  const alerts = sections?.reduce((n, s) => n + s.alerts.length, 0) ?? 0;
  const count = approvals + alerts;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Inbox: ${approvals} approvals, ${alerts} alerts`}
        title="Approvals and alerts from the projects"
        className="relative flex size-9 items-center justify-center rounded-full border border-line bg-surface text-base hover:bg-surface-2"
      >
        <span aria-hidden>🔔</span>
        {count > 0 && (
          <span
            className={`absolute -right-1 -top-1 min-w-5 rounded-full px-1 text-center text-[10px] font-bold leading-5 text-white ring-2 ring-white/70 ${
              approvals > 0 ? "bg-red-500" : "bg-slate-500"
            }`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open &&
        mounted &&
        createPortal(
          <InboxPanel
            sections={sections}
            failed={failed}
            onClose={() => setOpen(false)}
            onReload={load}
            setSections={setSections}
          />,
          document.body,
        )}
    </>
  );
}

function InboxPanel({
  sections,
  failed,
  onClose,
  onReload,
  setSections,
}: {
  sections: InboxSection[] | null;
  failed: string | null;
  onClose: () => void;
  onReload: () => Promise<void>;
  setSections: React.Dispatch<React.SetStateAction<InboxSection[] | null>>;
}) {
  const approvals = sections?.reduce((n, s) => n + s.authorizations.length, 0) ?? 0;
  const alerts = sections?.reduce((n, s) => n + s.alerts.length, 0) ?? 0;
  const [tab, setTab] = useState<"approvals" | "alerts">(approvals === 0 && alerts > 0 ? "alerts" : "approvals");
  const [note, setNote] = useState<{ text: string; link?: string | null; tone: "ok" | "error" } | null>(null);
  const [pending, start] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const drop = (project: string, kind: "authorizations" | "alerts", id: string | null) =>
    setSections((ss) =>
      ss?.map((s) =>
        s.project !== project ? s : { ...s, [kind]: id === null ? [] : (s[kind] as { id: string }[]).filter((x) => x.id !== id) },
      ) ?? ss,
    );

  function act(s: InboxSection, a: InboxAuthorization, action: string, label: string) {
    let reason: string | null = null;
    if (action === "approve") {
      if (!confirm(`Approve ${a.label}${a.amount != null ? ` (${amountFmt.format(Number(a.amount))})` : ""} in ${s.name}?`)) return;
    } else {
      reason = prompt(`${label} ${a.label} in ${s.name}? Reason (optional):`, "");
      if (reason === null) return;
    }
    setNote(null);
    start(async () => {
      const res = await actOnInboxItem(s.project, a.id, action, reason);
      if (!res.ok) return setNote({ text: res.error, tone: "error" });
      drop(s.project, "authorizations", a.id);
      const status = res.data?.status;
      const needsPost = s.project === "SSA" && action === "approve" && status === "approved";
      setNote({
        text: needsPost
          ? `${a.label} approved. Open it in SSA and press Post to post it.`
          : `${a.label}: ${status ?? "done"}.`,
        link: needsPost ? a.link : null,
        tone: "ok",
      });
      onReload();
    });
  }

  function read(s: InboxSection, alert: InboxAlert | null) {
    drop(s.project, "alerts", alert?.id ?? null);
    start(async () => {
      const res = await readInboxAlert(s.project, alert?.id ?? null);
      if (!res.ok) {
        setNote({ text: res.error, tone: "error" });
        onReload();
      }
    });
  }

  const tabBtn = (key: "approvals" | "alerts", label: string, n: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === key ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`}
    >
      {label}
      {n > 0 && (
        <span className={`ml-1.5 rounded-full px-1.5 text-xs text-white ${key === "approvals" ? "bg-red-500" : "bg-slate-500"}`}>{n}</span>
      )}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Inbox"
        className="flex h-full w-full max-w-md flex-col bg-bg shadow-2xl outline-none"
      >
        <div className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-600 px-4 py-3 text-white">
          <span aria-hidden>🔔</span>
          <h2 className="flex-1 font-semibold">Inbox</h2>
          <button type="button" onClick={() => onReload()} className="rounded-full px-2 py-1 text-sm hover:bg-white/20" aria-label="Refresh inbox">
            ↻
          </button>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm hover:bg-white/20" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-3 pb-0">
          <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {tabBtn("approvals", "Approvals", approvals)}
            {tabBtn("alerts", "Alerts", alerts)}
          </div>
          {note && (
            <p
              role="status"
              className={`mt-2 rounded-lg px-3 py-2 text-xs ${note.tone === "error" ? "bg-danger-soft text-danger" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"}`}
            >
              {note.text}{" "}
              {note.link && (
                <a href={note.link} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                  Open ↗
                </a>
              )}
            </p>
          )}
          {failed && !sections && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">Couldn’t load: {failed}</p>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {!sections ? (
            [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-2" />)
          ) : (
            sections.map((s) => {
              const items = tab === "approvals" ? s.authorizations : s.alerts;
              return (
                <section key={s.project} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                    <AppGlyph app={s} size="xs" />
                    <span className="flex-1 text-sm font-semibold">{s.name}</span>
                    {tab === "alerts" && s.alerts.length > 1 && (
                      <button type="button" onClick={() => read(s, null)} disabled={pending} className="text-xs text-muted hover:text-fg">
                        Mark all read
                      </button>
                    )}
                    {s.appUrl && (
                      <a href={s.appUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:text-fg">
                        Open ↗
                      </a>
                    )}
                  </div>
                  {s.error ? (
                    <p className="px-3 py-2 text-xs text-danger">Couldn’t load: {s.error}</p>
                  ) : items.length === 0 ? (
                    <p className="px-3 py-2.5 text-xs text-muted">{tab === "approvals" ? "Nothing waiting for you." : "No new alerts."}</p>
                  ) : tab === "approvals" ? (
                    <ul className="divide-y divide-line">
                      {s.authorizations.map((a) => (
                        <li key={a.id} className="space-y-1.5 px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{a.label}</p>
                              {a.detail && <p className="truncate text-xs text-muted">{a.detail}</p>}
                            </div>
                            <div className="shrink-0 text-right">
                              {a.amount != null && <p className="text-sm font-semibold tabular-nums">{amountFmt.format(Number(a.amount))}</p>}
                              {a.date && <p className="text-[11px] text-muted">{dateFmt.format(new Date(`${a.date}T00:00:00+05:00`))}</p>}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {a.can_act ? (
                              <>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => act(s, a, "approve", "Approve")}
                                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  ✓ Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => act(s, a, "reject", "Reject")}
                                  className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                                >
                                  ✕ Reject
                                </button>
                                {EXTRA[s.project] && (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => act(s, a, EXTRA[s.project]!.action, EXTRA[s.project]!.label)}
                                    className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-60"
                                  >
                                    {EXTRA[s.project]!.label}
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-[11px] text-muted">
                                {s.project === "MBL" ? "Authorize in MBL (its own sign-in)" : `Authorize this form in ${s.name}`}
                              </span>
                            )}
                            {a.link && (
                              <a
                                href={a.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`ml-auto text-xs ${a.can_act ? "text-muted hover:text-fg" : "rounded-lg bg-accent px-3 py-1 font-medium text-white"}`}
                              >
                                Open ↗
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="divide-y divide-line">
                      {s.alerts.map((n) => (
                        <li key={n.id} className="flex items-start gap-2 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm" dir="auto">
                              {n.title}
                            </p>
                            {n.body && (
                              <p className="text-xs text-muted" dir="auto">
                                {n.body}
                              </p>
                            )}
                            <p className="text-[11px] text-muted">{ago(n.at)}</p>
                          </div>
                          {n.link && (
                            <a
                              href={n.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => read(s, n)}
                              className="shrink-0 text-xs text-muted hover:text-fg"
                            >
                              Open ↗
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => read(s, n)}
                            disabled={pending}
                            aria-label="Mark read"
                            title="Mark read"
                            className="grid size-6 shrink-0 place-items-center rounded-full text-xs text-muted hover:bg-surface-2 hover:text-fg"
                          >
                            ✓
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
