"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addSsTask, tickSsTask } from "@/app/sstasks/actions";
import { onDashboardRefresh } from "@/lib/refresh-event";
import { addDays, karachiToday } from "@/lib/time";

// SS Tasks on the dashboard, Planner-style: the open tasks given to SS and
// the ones SS gave to others, as a list or a board, grouped by project, due
// date or priority under coloured headings. Ticking marks a task done in SS
// Tasks; a click opens it there; "+ Task" adds one to any of SS's projects.
// View, grouping, tab, folded groups and the last project are remembered in
// this browser.

const REFRESH_MS = 3 * 60 * 1000;
const PREFS_KEY = "dashboard.ssTasksPrefs";

type Priority = "urgent" | "important" | "medium" | "low";
type Task = {
  id: string;
  title: string;
  due: string | null;
  priority: Priority | null;
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
type Project = { id: string; name: string; color: string | null; workspace: string };
type Tab = "mine" | "by_me";
type View = "list" | "board";
type GroupBy = "project" | "due" | "priority";
type Prefs = { tab: Tab; view: View; groupBy: GroupBy; folded: string[]; lastProject: string | null };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tasks: Task[]; projects: Project[] };
type Group = { key: string; label: string; sub?: string; color: string; tasks: Task[] };

const DEFAULT_PREFS: Prefs = { tab: "mine", view: "list", groupBy: "project", folded: [], lastProject: null };
const GRAY = "#94a3b8";

const PRIORITIES: { key: Priority; label: string; color: string; chip: string }[] = [
  { key: "urgent", label: "Urgent", color: "#dc2626", chip: "bg-red-600 text-white" },
  { key: "important", label: "Important", color: "#f97316", chip: "bg-orange-500 text-white" },
  { key: "medium", label: "Medium", color: "#0ea5e9", chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  { key: "low", label: "Low", color: "#94a3b8", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
];
const DUE_GROUPS = [
  { key: "late", label: "Late", color: "#dc2626" },
  { key: "today", label: "Today", color: "#f59e0b" },
  { key: "week", label: "Next 7 days", color: "#0ea5e9" },
  { key: "later", label: "Later", color: "#8b5cf6" },
  { key: "none", label: "No date", color: GRAY },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = ({ y, m, d }: { y: number; m: number; d: number }) => `${y}-${pad(m)}-${pad(d)}`;
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

function dueGroup(due: string | null, today: string, week: string) {
  if (!due) return "none";
  if (due < today) return "late";
  if (due === today) return "today";
  if (due <= week) return "week";
  return "later";
}

const byDue = (a: Task, b: Task) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title);

export function SsTasks({ appUrl }: { appUrl: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (now = false) => {
    try {
      const res = await fetch(now ? "/api/sstasks?sync=now" : "/api/sstasks", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load SS Tasks");
      setState({ status: "ready", tasks: body.tasks, projects: body.projects ?? [] });
      // Google Tasks sync: keep showing the last problem until a pass runs clean.
      const sync = body.sync as { ran?: boolean; error?: string; errors?: string[] } | null;
      if (sync?.error) setSyncError(sync.error);
      else if (sync?.ran) setSyncError(sync.errors?.[0] ?? null);
    } catch (e) {
      setState((s) => (s.status === "ready" ? s : { status: "error", message: e instanceof Error ? e.message : "Could not load" }));
    }
  }, []);

  useEffect(() => {
    setPrefs(readPrefs());
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

  function setPref(patch: Partial<Prefs>) {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const foldKey = (g: string) => `${prefs.groupBy}:${g}`;
  const toggleFold = (g: string) =>
    setPref({ folded: prefs.folded.includes(foldKey(g)) ? prefs.folded.filter((k) => k !== foldKey(g)) : [...prefs.folded, foldKey(g)] });

  async function tick(task: Task) {
    setError(null);
    setTicking((s) => new Set(s).add(task.id));
    const res = await tickSsTask(task.id, true);
    if (res.ok) {
      setState((s) => (s.status === "ready" ? { ...s, tasks: s.tasks.filter((x) => x.id !== task.id) } : s));
      load(true); // ticks it in Google Tasks too
    } else setError(res.error);
    setTicking((s) => {
      const n = new Set(s);
      n.delete(task.id);
      return n;
    });
  }

  const today = karachiToday();
  const todayS = ymd(today);
  const tomorrowS = ymd(addDays(today, 1));
  const weekS = ymd(addDays(today, 7));
  const tasks = state.status === "ready" ? state.tasks : [];
  const projects = state.status === "ready" ? state.projects : [];
  const mine = tasks.filter((t) => t.mine);
  const byMe = tasks.filter((t) => t.by_me && !t.mine);
  const shown = prefs.tab === "mine" ? mine : byMe;
  const lateCount = (list: Task[]) => list.filter((t) => t.due && t.due < todayS).length;

  const groups: Group[] = useMemo(() => {
    if (prefs.groupBy === "due") {
      return DUE_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color, tasks: shown.filter((t) => dueGroup(t.due, todayS, weekS) === g.key).sort(byDue) })).filter(
        (g) => g.tasks.length,
      );
    }
    if (prefs.groupBy === "priority") {
      return [...PRIORITIES.map((p) => ({ key: p.key, label: p.label, color: p.color })), { key: "none", label: "No priority", color: GRAY }]
        .map((g) => ({ ...g, tasks: shown.filter((t) => (t.priority ?? "none") === g.key).sort(byDue) }))
        .filter((g) => g.tasks.length);
    }
    const map = new Map<string, Group>();
    for (const t of shown) {
      const g = map.get(t.project_id) ?? { key: t.project_id, label: t.project, sub: t.workspace, color: t.color || GRAY, tasks: [] };
      g.tasks.push(t);
      map.set(t.project_id, g);
    }
    // Projects with late work first, then by workspace and name.
    return [...map.values()]
      .map((g) => ({ ...g, tasks: g.tasks.sort(byDue) }))
      .sort(
        (a, b) =>
          Number(lateCount(b.tasks) > 0) - Number(lateCount(a.tasks) > 0) || (a.sub ?? "").localeCompare(b.sub ?? "") || a.label.localeCompare(b.label),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, prefs.groupBy, todayS, weekS]);

  function DueChip({ due }: { due: string | null }) {
    if (!due) return null;
    const g = dueGroup(due, todayS, weekS);
    const text = due === todayS ? "Today" : due === tomorrowS ? "Tomorrow" : dueFmt.format(new Date(`${due}T00:00:00Z`));
    const cls =
      g === "late"
        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
        : g === "today"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          : g === "week"
            ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
            : "bg-surface-2 text-muted";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${cls}`}>
        {g === "late" ? "⚠" : "📅"} {text}
      </span>
    );
  }

  function Chips({ t, compact = false }: { t: Task; compact?: boolean }) {
    const p = PRIORITIES.find((x) => x.key === t.priority);
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
        {prefs.groupBy !== "project" && (
          <span className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5" style={{ backgroundColor: tint(t.color || GRAY, 18) }} title={`${t.workspace} · ${t.project}`}>
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color || GRAY }} />
            <span className="truncate">{t.project}</span>
          </span>
        )}
        <DueChip due={t.due} />
        {p && p.key !== "medium" && prefs.groupBy !== "priority" && <span className={`rounded-full px-1.5 py-0.5 ${p.chip}`}>{p.label}</span>}
        {t.checks > 0 && (
          <span className={t.checked === t.checks ? "text-up" : ""}>
            ☑ {t.checked}/{t.checks}
          </span>
        )}
        {prefs.tab === "by_me" && t.assignees.length > 0 && !compact && <span className="truncate">→ {t.assignees.join(", ")}</span>}
      </span>
    );
  }

  const Tick = ({ t }: { t: Task }) => (
    <button
      type="button"
      onClick={() => tick(t)}
      disabled={ticking.has(t.id)}
      aria-label={`Mark "${t.title}" done`}
      title="Mark done"
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-line text-[10px] text-transparent transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-950"
    >
      ✓
    </button>
  );
  const href = (t: Task) => `${appUrl}/p/${t.project_id}?task=${t.id}`;

  const segBtn = (on: boolean) => `rounded-lg px-2.5 py-1 text-xs font-medium ${on ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`;

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm">
      {/* Title row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-lg">
          ✅
        </span>
        <h2 className="mr-auto truncate font-semibold">SS Tasks</h2>
        <div className="flex rounded-xl bg-surface-2 p-0.5" role="group" aria-label="View">
          <button type="button" onClick={() => setPref({ view: "list" })} aria-pressed={prefs.view === "list"} className={segBtn(prefs.view === "list")}>
            ☰ List
          </button>
          <button type="button" onClick={() => setPref({ view: "board" })} aria-pressed={prefs.view === "board"} className={segBtn(prefs.view === "board")}>
            ▦ Board
          </button>
        </div>
        <label className="flex items-center gap-1 text-xs text-muted">
          Group
          <select
            value={prefs.groupBy}
            onChange={(e) => setPref({ groupBy: e.target.value as GroupBy })}
            className="rounded-lg border border-line bg-surface px-1.5 py-1 text-xs text-fg"
          >
            <option value="project">Project</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        {projects.length > 0 && (
          <button type="button" onClick={() => setAdding((a) => !a)} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90">
            {adding ? "✕ Close" : "+ Task"}
          </button>
        )}
        <a href={appUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface-2" title="Open SS Tasks">
          Open ↗
        </a>
      </div>

      {adding && (
        <AddTask
          projects={projects}
          initialProject={prefs.lastProject}
          onAdded={(project) => {
            setPref({ lastProject: project, tab: "mine" });
            load(true);
          }}
        />
      )}

      {/* To me / By me */}
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
            aria-selected={prefs.tab === key}
            onClick={() => setPref({ tab: key })}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 font-medium ${
              prefs.tab === key ? "bg-surface shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {label}
            <span className="rounded-full bg-line/70 px-1.5 text-xs">{list.length}</span>
            {lateCount(list) > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{lateCount(list)} late</span>}
          </button>
        ))}
      </div>

      {syncError && (
        <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" title={syncError}>
          Google Tasks sync: {syncError}
        </p>
      )}
      {error && (
        <p className="mb-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {state.status === "loading" && <p className="text-sm text-muted">Loading…</p>}
      {state.status === "error" && <p className="text-sm text-danger">{state.message}</p>}
      {state.status === "ready" && shown.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">{prefs.tab === "mine" ? "Nothing on your plate 🎉" : "No open tasks given to others."}</p>
      )}

      {/* List view */}
      {prefs.view === "list" && groups.length > 0 && (
        <div className="max-h-[34rem] flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {groups.map((g) => {
            const folded = prefs.folded.includes(foldKey(g.key));
            const late = lateCount(g.tasks);
            return (
              <div key={g.key} className="overflow-hidden rounded-xl border border-line/70">
                <button
                  type="button"
                  onClick={() => toggleFold(g.key)}
                  aria-expanded={!folded}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                  style={{ backgroundColor: tint(g.color, 14), borderLeft: `4px solid ${g.color}` }}
                >
                  <span className="text-xs text-muted">{folded ? "▸" : "▾"}</span>
                  <span className="min-w-0 truncate text-sm font-semibold">{g.label}</span>
                  {g.sub && <span className="truncate text-xs text-muted">· {g.sub}</span>}
                  <span className="ml-auto flex items-center gap-1 text-xs">
                    {late > 0 && <span className="rounded-full bg-red-600 px-1.5 text-white">{late} late</span>}
                    <span className="rounded-full bg-surface/80 px-1.5 text-muted">{g.tasks.length}</span>
                  </span>
                </button>
                {!folded && (
                  <ul className="divide-y divide-line/50">
                    {g.tasks.map((t) => (
                      <li key={t.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-surface-2">
                        <Tick t={t} />
                        <a href={href(t)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.title}</span>
                          <Chips t={t} />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Board view */}
      {prefs.view === "board" && groups.length > 0 && (
        <div className="-mx-1 flex flex-1 gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          {groups.map((g) => (
            <div key={g.key} className="flex w-60 shrink-0 flex-col rounded-xl bg-surface-2/70" style={{ borderTop: `4px solid ${g.color}` }}>
              <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: tint(g.color, 10) }}>
                <span className="min-w-0 truncate text-sm font-semibold">{g.label}</span>
                <span className="ml-auto rounded-full bg-surface/80 px-1.5 text-xs text-muted">{g.tasks.length}</span>
              </div>
              {g.sub && <p className="-mt-1 px-3 pb-1 text-[11px] text-muted" style={{ backgroundColor: tint(g.color, 10) }}>{g.sub}</p>}
              <ul className="max-h-[30rem] space-y-2 overflow-y-auto p-2 [scrollbar-width:thin]">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 rounded-lg border border-line bg-surface p-2 shadow-sm transition hover:shadow-md">
                    <Tick t={t} />
                    <a href={href(t)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium">{t.title}</span>
                      <Chips t={t} compact />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Quick add: title, project, due date and priority; the task is assigned to SS. */
function AddTask({ projects, initialProject, onAdded }: { projects: Project[]; initialProject: string | null; onAdded: (project: string) => void }) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(projects.some((p) => p.id === initialProject) ? initialProject! : projects[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaces = [...new Set(projects.map((p) => p.workspace))];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await addSsTask(project, title, due || null, priority || null);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setTitle("");
    setDue("");
    setPriority("");
    onAdded(project);
  }

  const field = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="mb-3 space-y-2 rounded-xl border border-line bg-surface-2/60 p-2">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" maxLength={300} className={`${field} w-full`} />
      <div className="flex flex-wrap gap-2">
        <select value={project} onChange={(e) => setProject(e.target.value)} className={`${field} min-w-0 flex-1`} aria-label="Project">
          {workspaces.map((w) => (
            <optgroup key={w} label={w}>
              {projects
                .filter((p) => p.workspace === w)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} aria-label="Due date" />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={field} aria-label="Priority">
          <option value="">Priority</option>
          {PRIORITIES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy || !title.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
