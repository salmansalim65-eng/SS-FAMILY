"use client";

import { useCallback, useEffect, useState } from "react";
import { tickSsTask } from "@/app/sstasks/actions";
import { onDashboardRefresh } from "@/lib/refresh-event";
import { addDays, karachiToday } from "@/lib/time";

// SS Tasks on the dashboard: the open tasks given to SS, and the ones SS
// gave to others, grouped by when they are due. Ticking one marks it done
// in SS Tasks; a click opens it there.

const REFRESH_MS = 3 * 60 * 1000;
const TAB_KEY = "dashboard.ssTasksTab";

type Task = {
  id: string;
  title: string;
  due: string | null;
  priority: "urgent" | "important" | "medium" | "low" | null;
  project_id: string;
  project: string;
  color: string | null;
  workspace: string;
  mine: boolean;
  by_me: boolean;
  assignees: string[];
  checks: number;
  checked: number;
};
type Tab = "mine" | "by_me";
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tasks: Task[] };

const PRIORITY: Record<string, { label: string; chip: string }> = {
  urgent: { label: "Urgent", chip: "bg-red-600 text-white" },
  important: { label: "Important", chip: "bg-orange-500 text-white" },
  low: { label: "Low", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = ({ y, m, d }: { y: number; m: number; d: number }) => `${y}-${pad(m)}-${pad(d)}`;
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

const GROUPS = [
  { key: "late", label: "Late", tone: "text-danger" },
  { key: "today", label: "Today", tone: "text-accent" },
  { key: "week", label: "Next 7 days", tone: "text-fg" },
  { key: "later", label: "Later", tone: "text-muted" },
  { key: "none", label: "No date", tone: "text-muted" },
] as const;

function groupOf(due: string | null, today: string, week: string) {
  if (!due) return "none";
  if (due < today) return "late";
  if (due === today) return "today";
  if (due <= week) return "week";
  return "later";
}

export function SsTasks({ appUrl }: { appUrl: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("mine");
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (now = false) => {
    try {
      const res = await fetch(now ? "/api/sstasks?sync=now" : "/api/sstasks", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load SS Tasks");
      setState({ status: "ready", tasks: body.tasks });
    } catch (e) {
      setState((s) => (s.status === "ready" ? s : { status: "error", message: e instanceof Error ? e.message : "Could not load" }));
    }
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "by_me") setTab("by_me");
    } catch {}
    load();
    const t = setInterval(() => load(), REFRESH_MS);
    const off = onDashboardRefresh(() => load(true));
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      off();
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  function pick(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  }

  async function tick(task: Task) {
    setError(null);
    setTicking((s) => new Set(s).add(task.id));
    const res = await tickSsTask(task.id, true);
    if (res.ok) {
      setState((s) => (s.status === "ready" ? { ...s, tasks: s.tasks.filter((x) => x.id !== task.id) } : s));
      load(true); // ticks it in Google Tasks too
    } else {
      setError(res.error);
    }
    setTicking((s) => {
      const n = new Set(s);
      n.delete(task.id);
      return n;
    });
  }

  const today = karachiToday();
  const todayS = ymd(today);
  const weekS = ymd(addDays(today, 7));
  const tasks = state.status === "ready" ? state.tasks : [];
  const mine = tasks.filter((t) => t.mine);
  const byMe = tasks.filter((t) => t.by_me && !t.mine);
  const shown = tab === "mine" ? mine : byMe;
  const lateCount = (list: Task[]) => list.filter((t) => t.due && t.due < todayS).length;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="text-lg">✅</span>
        <h2 className="flex-1 truncate font-semibold">SS Tasks</h2>
        <a
          href={appUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface-2"
          title="Open SS Tasks"
        >
          Open ↗
        </a>
      </div>

      <div role="tablist" className="mb-3 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
        {(
          [
            ["mine", "To me", mine],
            ["by_me", "By me", byMe],
          ] as const
        ).map(([key, label, list]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => pick(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 font-medium ${
              tab === key ? "bg-surface shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {label}
            <span className="rounded-full bg-line/70 px-1.5 text-xs">{list.length}</span>
            {lateCount(list) > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white" title={`${lateCount(list)} late`}>{lateCount(list)} late</span>}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="max-h-[28rem] flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {state.status === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {state.status === "error" && <p className="text-sm text-danger">{state.message}</p>}
        {state.status === "ready" && shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">{tab === "mine" ? "Nothing on your plate 🎉" : "No open tasks given to others."}</p>
        )}
        {GROUPS.map((g) => {
          const items = shown.filter((t) => groupOf(t.due, todayS, weekS) === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key} className="mb-3">
              <h3 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${g.tone}`}>
                {g.label} · {items.length}
              </h3>
              <ul className="space-y-1">
                {items.map((t) => {
                  const p = t.priority ? PRIORITY[t.priority] : undefined;
                  const late = !!t.due && t.due < todayS;
                  return (
                    <li key={t.id} className="group flex items-start gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                      <button
                        type="button"
                        onClick={() => tick(t)}
                        disabled={ticking.has(t.id)}
                        aria-label={`Mark "${t.title}" done`}
                        title="Mark done"
                        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-line text-[10px] text-transparent hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
                      >
                        ✓
                      </button>
                      <a
                        href={`${appUrl}/p/${t.project_id}?task=${t.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1"
                      >
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                          <span
                            className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5"
                            style={{ backgroundColor: `color-mix(in srgb, ${t.color || "#64748b"} 18%, transparent)` }}
                            title={`${t.workspace} · ${t.project}`}
                          >
                            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color || "#64748b" }} />
                            <span className="truncate">{t.project}</span>
                          </span>
                          {p && <span className={`rounded-full px-1.5 py-0.5 ${p.chip}`}>{p.label}</span>}
                          {t.due && (
                            <span className={`rounded-full px-1.5 py-0.5 ${late ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-surface-2"}`}>
                              📅 {dueFmt.format(new Date(`${t.due}T00:00:00Z`))}
                            </span>
                          )}
                          {t.checks > 0 && (
                            <span>
                              ☑ {t.checked}/{t.checks}
                            </span>
                          )}
                          {tab === "by_me" && t.assignees.length > 0 && <span className="truncate">→ {t.assignees.join(", ")}</span>}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
