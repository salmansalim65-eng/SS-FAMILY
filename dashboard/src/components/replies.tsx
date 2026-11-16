"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addReply, deleteReply, listReplies, updateReply } from "@/app/replies/actions";
import { onDashboardRefresh } from "@/lib/refresh-event";
import { PENDING_SHARE_KEY, parseShared, type Reply } from "@/lib/replies";

// "Replies pending": messages SS still has to answer. WhatsApp → Share →
// SS Dashboard lands here (via /share) with the message filled in; it can also
// be added by hand. Late ones are red; ✓ marks one answered.

const SYNC_MS = 60_000;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function karachiDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

type Draft = { id: string | null; sender: string; message: string; due: string | null };

export function Replies() {
  const [items, setItems] = useState<Reply[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fromShare, setFromShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    const r = await listReplies();
    if (r.ok) {
      setItems(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, SYNC_MS);
    const off = onDashboardRefresh(load);
    return () => {
      clearInterval(t);
      off();
    };
  }, [load]);

  // A message shared from WhatsApp (parked by /share): open it, ready to save.
  useEffect(() => {
    const pick = () => {
      try {
        const raw = localStorage.getItem(PENDING_SHARE_KEY);
        if (!raw) return;
        localStorage.removeItem(PENDING_SHARE_KEY);
        const p = JSON.parse(raw) as { text?: string; at?: number };
        if (!p.text || (p.at && Date.now() - p.at > PENDING_MAX_AGE_MS)) return;
        const { sender, message } = parseShared(p.text);
        setDraft({ id: null, sender, message, due: karachiDate(0) });
        setFromShare(true);
        setTimeout(() => boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      } catch {}
    };
    pick();
    // The installed app may already be open when Share brings it forward.
    const onShow = () => document.visibilityState === "visible" && pick();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", pick);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", pick);
    };
  }, []);

  const today = karachiDate(0);
  const list = items ?? [];
  const pending = list.filter((r) => !r.done);
  const done = list.filter((r) => r.done);
  const late = pending.filter((r) => r.due && r.due < today).length;
  const senders = [...new Set(list.map((r) => r.sender).filter(Boolean))].slice(0, 50);

  async function save() {
    if (!draft) return;
    setSaving(true);
    const r = draft.id
      ? await updateReply(draft.id, { sender: draft.sender, message: draft.message, due: draft.due })
      : await addReply({ sender: draft.sender, message: draft.message, due: draft.due });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    setDraft(null);
    setFromShare(false);
    setError(null);
    load();
  }

  async function setDone(r: Reply, value: boolean) {
    setItems((xs) => xs?.map((x) => (x.id === r.id ? { ...x, done: value, done_at: value ? new Date().toISOString() : null } : x)) ?? xs);
    const res = await updateReply(r.id, { done: value });
    if (!res.ok) setError(res.error);
    load();
  }

  async function remove(r: Reply) {
    if (!confirm("Delete this message from the list?")) return;
    setItems((xs) => xs?.filter((x) => x.id !== r.id) ?? xs);
    const res = await deleteReply(r.id);
    if (!res.ok) setError(res.error);
    load();
  }

  const dueChips: { label: string; value: string | null }[] = [
    { label: "Today", value: karachiDate(0) },
    { label: "Tomorrow", value: karachiDate(1) },
    { label: "This week", value: karachiDate(6) },
    { label: "No date", value: null },
  ];

  return (
    <section id="replies" ref={boxRef} className="scroll-mt-4 rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">💬 Replies pending</h2>
        {pending.length > 0 && <span className="rounded-full bg-surface-2 px-2 text-xs font-medium">{pending.length}</span>}
        {late > 0 && <span className="rounded-full bg-danger px-2 text-xs font-semibold text-white">{late} late</span>}
        <button
          type="button"
          onClick={() => {
            setDraft({ id: null, sender: "", message: "", due: karachiDate(0) });
            setFromShare(false);
          }}
          className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-sm hover:bg-surface-2"
          title="Add a message to reply to"
        >
          ＋ Add
        </button>
      </div>

      {error && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

      {draft && (
        <div className="mt-3 space-y-2 rounded-xl border border-accent/40 bg-surface-2 p-3">
          {fromShare && <p className="text-xs text-muted">From WhatsApp — check the name and when to reply, then Save.</p>}
          <input
            list="reply-senders"
            value={draft.sender}
            onChange={(e) => setDraft({ ...draft, sender: e.target.value })}
            placeholder="From (name)"
            maxLength={120}
            autoFocus={fromShare && !draft.sender}
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <datalist id="reply-senders">
            {senders.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <textarea
            value={draft.message}
            onChange={(e) => setDraft({ ...draft, message: e.target.value })}
            placeholder="The message (or what to reply about)"
            rows={3}
            maxLength={4000}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-xs text-muted">Reply by</span>
            {dueChips.map((c) => {
              const on = draft.due === c.value;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setDraft({ ...draft, due: c.value })}
                  className={`rounded-full border px-2.5 py-0.5 ${on ? "border-accent bg-accent text-white" : "border-line hover:bg-surface"}`}
                >
                  {c.label}
                </button>
              );
            })}
            <input
              type="date"
              aria-label="Reply by date"
              value={draft.due ?? ""}
              onChange={(e) => setDraft({ ...draft, due: e.target.value || null })}
              className="rounded-full border border-line bg-surface px-2 py-0.5 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setFromShare(false);
              }}
              className="rounded-full px-3 py-1 text-sm text-muted hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || (!draft.sender.trim() && !draft.message.trim())}
              onClick={save}
              className="rounded-full bg-accent px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {items === null && !error && <li className="text-sm text-muted">Loading…</li>}
        {items !== null && pending.length === 0 && !draft && (
          <li className="text-sm text-muted">Nothing to reply to. In WhatsApp: hold a message → Share → SS Dashboard.</li>
        )}
        {pending.map((r) => {
          const isLate = !!r.due && r.due < today;
          const isToday = r.due === today;
          const expanded = open === r.id;
          return (
            <li key={r.id} className={`group flex gap-2 rounded-xl border bg-surface px-3 py-2 ${isLate ? "border-danger/50" : "border-line"}`}>
              <button
                type="button"
                onClick={() => setDone(r, true)}
                title="Mark replied"
                aria-label="Mark replied"
                className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-line hover:border-accent hover:bg-accent/10"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-semibold">{r.sender || "Unknown"}</span>
                  {r.due && (
                    <span
                      className={`rounded-full px-1.5 text-xs ${isLate ? "bg-danger text-white" : isToday ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100" : "bg-surface-2 text-muted"}`}
                    >
                      {isLate ? `Late · ${dmy(r.due)}` : isToday ? "Today" : dmy(r.due)}
                    </span>
                  )}
                  <span className="text-xs text-muted">{ago(r.created_at)}</span>
                </div>
                {r.message && (
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.id)}
                    dir="auto"
                    className={`mt-0.5 block w-full whitespace-pre-wrap text-left text-sm text-muted ${expanded ? "" : "line-clamp-2"}`}
                  >
                    {r.message}
                  </button>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1 opacity-60 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ id: r.id, sender: r.sender, message: r.message, due: r.due });
                    setFromShare(false);
                  }}
                  title="Edit"
                  className="text-xs hover:text-accent"
                >
                  ✎
                </button>
                <button type="button" onClick={() => remove(r)} title="Delete" className="text-xs hover:text-danger">
                  🗑
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {done.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-muted hover:text-fg">
            {showDone ? "▾" : "▸"} Replied ({done.length})
          </button>
          {showDone && (
            <ul className="mt-1 space-y-1">
              {done.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm text-muted">
                  <button type="button" onClick={() => setDone(r, false)} title="Not replied yet" className="text-accent">
                    ✓
                  </button>
                  <span className="truncate line-through">
                    {r.sender || "Unknown"}
                    {r.message ? ` — ${r.message}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
