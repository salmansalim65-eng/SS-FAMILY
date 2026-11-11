"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addSsTask, editSsTask, tickSsTask } from "@/app/sstasks/actions";
import { onDashboardRefresh } from "@/lib/refresh-event";
import { addDays, karachiToday } from "@/lib/time";

// SS Tasks on the dashboard, Planner-style: the open tasks given to SS and
// the ones SS gave to others, as a list or a board, grouped by project,
// progress, due date or priority under coloured headings that fold.
// Drag a task to another group to move it (project, column, due date or
// priority); ⋯ on a task changes the same things; tick marks it done; a
// click opens it in SS Tasks; "+ Task" adds one. Filters narrow the view.
// View, grouping, tab and folded groups are remembered in this browser.

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
  bucket: string | null;
};
type Project = { id: string; name: string; color: string | null; workspace: string };
type Tab = "mine" | "by_me";
type View = "list" | "board";
type GroupBy = "project" | "progress" | "due" | "priority";
type Filter = "late" | "today" | "week" | "high";
type Prefs = { tab: Tab; view: View; groupBy: GroupBy; folded: string[]; lastProject: string | null };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tasks: Task[]; projects: Project[] };
type Group = { key: string; label: string; sub?: string; color: string; tasks: Task[]; droppable: boolean };
type Patch = { due?: string | null; priority?: string | null; project?: string; bucket?: string };

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
const PROGRESS = [
  { key: "to do", label: "To do", color: "#64748b" },
  { key: "in progress", label: "In progress", color: "#f59e0b" },
];
const FILTERS: { key: Filter; label: string }[] = [
  { key: "late", label: "⚠ Late" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "high", label: "Urgent & important" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = ({ y, m, d }: { y: number; m: number; d: number }) => `${y}-${pad(m)}-${pad(d)}`;
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

function readPrefs(): Prefs {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
    return Array.isArray(p.folded) ? p : DEFAULT_PREFS;
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
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Set<Filter>>(new Set());

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

  const today = karachiToday();
  const todayS = ymd(today);
  const tomorrowS = ymd(addDays(today, 1));
  const weekS = ymd(addDays(today, 7));
  const nextWeekS = ymd(addDays(today, 7));
  const laterS = ymd(addDays(today, 8));
  const tasks = useMemo(() => (state.status === "ready" ? state.tasks : []), [state]);
  const projects = state.status === "ready" ? state.projects : [];
  const mine = tasks.filter((t) => t.mine);
  const byMe = tasks.filter((t) => t.by_me && !t.mine);
  const lateCount = (list: Task[]) => list.filter((t) => t.due && t.due < todayS).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (prefs.tab === "mine" ? mine : byMe).filter((t) => {
      if (needle && !`${t.title} ${t.project} ${t.workspace}`.toLowerCase().includes(needle)) return false;
      if (filters.has("late") && !(t.due && t.due < todayS)) return false;
      if (filters.has("today") && t.due !== todayS) return false;
      if (filters.has("week") && !(t.due && t.due >= todayS && t.due <= weekS)) return false;
      if (filters.has("high") && t.priority !== "urgent" && t.priority !== "important") return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, prefs.tab, q, filters, todayS, weekS]);

  const groups: Group[] = useMemo(() => {
    if (prefs.groupBy === "due") {
      return DUE_GROUPS.map((g) => ({
        key: g.key,
        label: g.label,
        color: g.color,
        droppable: g.key !== "late",
        tasks: shown.filter((t) => dueGroup(t.due, todayS, weekS) === g.key).sort(byDue),
      })).filter((g) => g.tasks.length || g.droppable);
    }
    if (prefs.groupBy === "priority") {
      return [...PRIORITIES.map((p) => ({ key: p.key, label: p.label, color: p.color })), { key: "none", label: "No priority", color: GRAY }].map((g) => ({
        ...g,
        droppable: true,
        tasks: shown.filter((t) => (t.priority ?? "none") === g.key).sort(byDue),
      }));
    }
    if (prefs.groupBy === "progress") {
      const names = [...new Set([...PROGRESS.map((p) => p.key), ...shown.map((t) => (t.bucket ?? "To do").toLowerCase())])];
      return names.map((n) => {
        const known = PROGRESS.find((p) => p.key === n);
        const label = known?.label ?? shown.find((t) => (t.bucket ?? "").toLowerCase() === n)?.bucket ?? n;
        return { key: n, label, color: known?.color ?? "#8b5cf6", droppable: true, tasks: shown.filter((t) => (t.bucket ?? "To do").toLowerCase() === n).sort(byDue) };
      });
    }
    const map = new Map<string, Group>();
    for (const t of shown) {
      const g = map.get(t.project_id) ?? { key: t.project_id, label: t.project, sub: t.workspace, color: t.color || GRAY, tasks: [], droppable: true };
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

  const foldKey = (g: string) => `${prefs.groupBy}:${g}`;
  const isFolded = (g: string) => prefs.folded.includes(foldKey(g));
  const toggleFold = (g: string) => setPref({ folded: isFolded(g) ? prefs.folded.filter((k) => k !== foldKey(g)) : [...prefs.folded, foldKey(g)] });
  const allFolded = groups.length > 0 && groups.every((g) => isFolded(g.key));
  const foldAll = () => {
    const keys = groups.map((g) => foldKey(g.key));
    setPref({ folded: allFolded ? prefs.folded.filter((k) => !keys.includes(k)) : [...new Set([...prefs.folded, ...keys])] });
  };

  function mark(id: string, on: boolean) {
    setBusy((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function tick(task: Task) {
    setError(null);
    mark(task.id, true);
    const res = await tickSsTask(task.id, true);
    if (res.ok) {
      setState((s) => (s.status === "ready" ? { ...s, tasks: s.tasks.filter((x) => x.id !== task.id) } : s));
      load(true); // ticks it in Google Tasks too
    } else setError(res.error);
    mark(task.id, false);
  }

  /** Changes a task at once on screen, then in SS Tasks; reloads either way. */
  async function edit(task: Task, patch: Patch) {
    setError(null);
    const p = patch.project ? projects.find((x) => x.id === patch.project) : undefined;
    setState((s) =>
      s.status === "ready"
        ? {
            ...s,
            tasks: s.tasks.map((t) =>
              t.id !== task.id
                ? t
                : {
                    ...t,
                    ...(patch.due !== undefined ? { due: patch.due } : {}),
                    ...(patch.priority !== undefined ? { priority: (patch.priority || null) as Priority | null } : {}),
                    ...(patch.bucket !== undefined ? { bucket: patch.bucket } : {}),
                    ...(p ? { project_id: p.id, project: p.name, color: p.color, workspace: p.workspace, bucket: "To do" } : {}),
                  },
            ),
          }
        : s,
    );
    mark(task.id, true);
    const res = await editSsTask(task.id, patch);
    mark(task.id, false);
    if (!res.ok) setError(res.error);
    load(true);
  }

  /** What dropping a task on a group changes, for the current grouping. */
  function dropPatch(g: Group): Patch | null {
    if (!g.droppable) return null;
    if (prefs.groupBy === "project") return { project: g.key };
    if (prefs.groupBy === "priority") return { priority: g.key === "none" ? null : g.key };
    if (prefs.groupBy === "progress") return { bucket: g.label };
    return { due: g.key === "today" ? todayS : g.key === "week" ? tomorrowS : g.key === "later" ? laterS : null };
  }
  const dropProps = (g: Group) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId || !g.droppable) return;
      e.preventDefault();
      setOver(g.key);
    },
    onDragLeave: () => setOver((o) => (o === g.key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const t = tasks.find((x) => x.id === dragId);
      setDragId(null);
      const patch = dropPatch(g);
      if (t && patch && !g.tasks.some((x) => x.id === t.id)) edit(t, patch);
    },
  });
  const dragProps = (t: Task) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.id);
      setDragId(t.id);
      setMenu(null);
    },
    onDragEnd: () => {
      setDragId(null);
      setOver(null);
    },
  });

  function dueChip(due: string | null) {
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

  function chips(t: Task, compact = false) {
    const p = PRIORITIES.find((x) => x.key === t.priority);
    return (
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
        {prefs.groupBy !== "project" && (
          <span className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full px-2 py-0.5" style={{ backgroundColor: tint(t.color || GRAY, 18) }} title={`${t.workspace} · ${t.project}`}>
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color || GRAY }} />
            <span className="truncate">{t.project}</span>
          </span>
        )}
        {dueChip(t.due)}
        {p && p.key !== "medium" && prefs.groupBy !== "priority" && <span className={`rounded-full px-1.5 py-0.5 ${p.chip}`}>{p.label}</span>}
        {prefs.groupBy !== "progress" && (t.bucket ?? "").toLowerCase() === "in progress" && (
          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-200">◐ In progress</span>
        )}
        {t.checks > 0 && (
          <span className={t.checked === t.checks ? "text-up" : ""}>
            ☑ {t.checked}/{t.checks}
          </span>
        )}
        {prefs.tab === "by_me" && t.assignees.length > 0 && !compact && <span className="truncate">→ {t.assignees.join(", ")}</span>}
      </span>
    );
  }

  const tickBtn = (t: Task) => (
    <button
      type="button"
      onClick={() => tick(t)}
      disabled={busy.has(t.id)}
      aria-label={`Mark "${t.title}" done`}
      title="Mark done"
      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-line text-[10px] text-transparent transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-950"
    >
      ✓
    </button>
  );
  const href = (t: Task) => `${appUrl}/p/${t.project_id}?task=${t.id}`;

  /** One task: tick, title + chips (opens SS Tasks), ⋯ menu. */
  function row(t: Task, card = false) {
    return (
      <div
        {...dragProps(t)}
        className={`group relative flex cursor-grab items-start gap-2 active:cursor-grabbing ${
          card ? "rounded-lg border border-line bg-surface p-2 shadow-sm transition hover:shadow-md" : "px-3 py-1.5 hover:bg-surface-2"
        } ${dragId === t.id ? "opacity-40" : ""} ${busy.has(t.id) ? "animate-pulse" : ""}`}
      >
        {tickBtn(t)}
        <a href={href(t)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1" draggable={false}>
          <span className={`${card ? "line-clamp-2" : "block truncate"} text-sm font-medium`}>{t.title}</span>
          {chips(t, card)}
        </a>
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu((m) => (m?.id === t.id ? null : { id: t.id, rect }));
          }}
          aria-label="Task options"
          title="Due date, priority, progress, move"
          className={`shrink-0 rounded-md px-1.5 text-base leading-6 text-muted hover:bg-line/60 hover:text-fg ${menu?.id === t.id ? "bg-line/60 text-fg" : "opacity-60 group-hover:opacity-100"}`}
        >
          ⋯
        </button>
        {menu?.id === t.id && (
          <TaskMenu
            anchor={menu.rect}
            task={t}
            projects={projects}
            dates={{ today: todayS, tomorrow: tomorrowS, nextWeek: nextWeekS }}
            onEdit={(patch) => edit(t, patch)}
            onClose={() => setMenu(null)}
            openHref={href(t)}
          />
        )}
      </div>
    );
  }

  const segBtn = (on: boolean) => `rounded-lg px-2.5 py-1 text-xs font-medium ${on ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`;
  const dropRing = (g: Group) => (over === g.key ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : "");

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
          <select value={prefs.groupBy} onChange={(e) => setPref({ groupBy: e.target.value as GroupBy })} className="rounded-lg border border-line bg-surface px-1.5 py-1 text-xs text-fg">
            <option value="project">Project</option>
            <option value="progress">Progress</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <button
          type="button"
          onClick={foldAll}
          disabled={!groups.length}
          title={allFolded ? "Expand all groups" : "Collapse all groups"}
          className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
        >
          {allFolded ? "⊞ Expand" : "⊟ Collapse"}
        </button>
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
      <div role="tablist" className="mb-2 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
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
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 font-medium ${prefs.tab === key ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`}
          >
            {label}
            <span className="rounded-full bg-line/70 px-1.5 text-xs">{list.length}</span>
            {lateCount(list) > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{lateCount(list)} late</span>}
          </button>
        ))}
      </div>

      {/* Search and filters */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks…"
          className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-surface px-2.5 py-1 text-sm"
        />
        {FILTERS.map((f) => {
          const on = filters.has(f.key);
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setFilters((s) => {
                  const n = new Set(s);
                  if (on) n.delete(f.key);
                  else n.add(f.key);
                  return n;
                })
              }
              className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent bg-accent text-white" : "border-line hover:bg-surface-2"}`}
            >
              {f.label}
            </button>
          );
        })}
        {(filters.size > 0 || q) && (
          <button type="button" onClick={() => (setFilters(new Set()), setQ(""))} className="text-xs text-accent hover:underline">
            Clear
          </button>
        )}
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
        <p className="py-4 text-center text-sm text-muted">
          {filters.size || q ? "No tasks match." : prefs.tab === "mine" ? "Nothing on your plate 🎉" : "No open tasks given to others."}
        </p>
      )}

      {/* List view */}
      {prefs.view === "list" && shown.length > 0 && (
        <div className="max-h-[34rem] flex-1 space-y-2 overflow-y-auto p-0.5 pr-1 [scrollbar-width:thin]">
          {groups.map((g) => {
            const folded = isFolded(g.key);
            const late = lateCount(g.tasks);
            return (
              <div key={g.key} {...dropProps(g)} className={`overflow-hidden rounded-xl border border-line/70 transition ${dropRing(g)}`}>
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
                {!folded &&
                  (g.tasks.length ? (
                    <ul className="divide-y divide-line/50">
                      {g.tasks.map((t) => (
                        <li key={t.id}>
                          {row(t)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted">{dragId ? "Drop here" : "No tasks"}</p>
                  ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Board view */}
      {prefs.view === "board" && shown.length > 0 && (
        <div className="-mx-1 flex flex-1 gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          {groups.map((g) =>
            isFolded(g.key) ? (
              <button
                key={g.key}
                type="button"
                {...dropProps(g)}
                onClick={() => toggleFold(g.key)}
                title={`Expand ${g.label}`}
                className={`flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl bg-surface-2/70 py-2 transition ${dropRing(g)}`}
                style={{ borderTop: `4px solid ${g.color}` }}
              >
                <span className="rounded-full bg-surface/80 px-1.5 text-xs text-muted">{g.tasks.length}</span>
                <span className="text-sm font-semibold [writing-mode:vertical-rl]">{g.label}</span>
              </button>
            ) : (
              <div key={g.key} {...dropProps(g)} className={`flex w-60 shrink-0 flex-col rounded-xl bg-surface-2/70 transition ${dropRing(g)}`} style={{ borderTop: `4px solid ${g.color}` }}>
                <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: tint(g.color, 10) }}>
                  <button type="button" onClick={() => toggleFold(g.key)} title="Collapse" className="text-xs text-muted hover:text-fg">
                    ◂
                  </button>
                  <span className="min-w-0 truncate text-sm font-semibold">{g.label}</span>
                  {lateCount(g.tasks) > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{lateCount(g.tasks)}</span>}
                  <span className="ml-auto rounded-full bg-surface/80 px-1.5 text-xs text-muted">{g.tasks.length}</span>
                </div>
                {g.sub && (
                  <p className="-mt-1 px-3 pb-1 text-[11px] text-muted" style={{ backgroundColor: tint(g.color, 10) }}>
                    {g.sub}
                  </p>
                )}
                <ul className="max-h-[30rem] min-h-16 space-y-2 overflow-y-auto p-2 [scrollbar-width:thin]">
                  {g.tasks.map((t) => (
                    <li key={t.id}>
                      {row(t, true)}
                    </li>
                  ))}
                  {!g.tasks.length && <li className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-muted">{dragId ? "Drop here" : "No tasks"}</li>}
                </ul>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/** ⋯ on a task: due date, priority, progress and project, applied at once. */
function TaskMenu({
  anchor,
  task,
  projects,
  dates,
  onEdit,
  onClose,
  openHref,
}: {
  anchor: DOMRect;
  task: Task;
  projects: Project[];
  dates: { today: string; tomorrow: string; nextWeek: string };
  onEdit: (patch: Patch) => void;
  onClose: () => void;
  openHref: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // The menu floats over the page at the ⋯ button; scrolling the page closes it.
    const onScroll = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);
  const W = 264;
  const left = Math.max(8, Math.min(anchor.right - W, window.innerWidth - W - 8));
  const below = window.innerHeight - anchor.bottom > 430 || anchor.top < 430;
  const pos: React.CSSProperties = below ? { left, top: anchor.bottom + 4 } : { left, bottom: window.innerHeight - anchor.top + 4 };
  const workspaces = [...new Set(projects.map((p) => p.workspace))];
  const quick = "rounded-full border border-line px-2 py-0.5 text-xs hover:bg-surface-2";
  const label = "text-[11px] font-semibold uppercase tracking-wide text-muted";
  const progress = (task.bucket ?? "To do").toLowerCase();

  return (
    <div ref={ref} role="dialog" aria-label="Task options" style={pos} className="fixed z-50 max-h-[85vh] w-[264px] space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-sm shadow-xl" draggable={false}>
      <div className="space-y-1.5">
        <p className={label}>Due date</p>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={quick} onClick={() => onEdit({ due: dates.today })}>
            Today
          </button>
          <button type="button" className={quick} onClick={() => onEdit({ due: dates.tomorrow })}>
            Tomorrow
          </button>
          <button type="button" className={quick} onClick={() => onEdit({ due: dates.nextWeek })}>
            Next week
          </button>
          {task.due && (
            <button type="button" className={`${quick} text-danger`} onClick={() => onEdit({ due: null })}>
              Clear
            </button>
          )}
        </div>
        <input type="date" value={task.due ?? ""} onChange={(e) => onEdit({ due: e.target.value || null })} className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" aria-label="Due date" />
      </div>
      <div className="space-y-1.5">
        <p className={label}>Priority</p>
        <div className="flex flex-wrap gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onEdit({ priority: task.priority === p.key ? null : p.key })}
              className={`rounded-full px-2 py-0.5 text-xs ${task.priority === p.key ? p.chip : "border border-line hover:bg-surface-2"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className={label}>Progress</p>
        <div className="flex gap-1">
          {PROGRESS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => progress !== p.key && onEdit({ bucket: p.label })}
              className={`flex-1 rounded-lg px-2 py-1 text-xs ${progress === p.key ? "bg-accent text-white" : "border border-line hover:bg-surface-2"}`}
            >
              {p.key === "to do" ? "○ " : "◐ "}
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {projects.length > 0 && (
        <div className="space-y-1.5">
          <p className={label}>Move to project</p>
          <select value={task.project_id} onChange={(e) => onEdit({ project: e.target.value })} className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" aria-label="Project">
            {!projects.some((p) => p.id === task.project_id) && <option value={task.project_id}>{task.project}</option>}
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
        </div>
      )}
      <div className="flex justify-between border-t border-line pt-2 text-xs">
        <a href={openHref} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          Open in SS Tasks ↗
        </a>
        <button type="button" onClick={onClose} className="text-muted hover:text-fg">
          Close
        </button>
      </div>
    </div>
  );
}

/** Quick add: title, project, due date and priority; the task is assigned to SS. */
function AddTask({ projects, initialProject, onAdded }: { projects: Project[]; initialProject: string | null; onAdded: (project: string) => void }) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(projects.some((p) => p.id === initialProject) ? initialProject! : (projects[0]?.id ?? ""));
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
