"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addSsProject, addSsTask, assignTask, assignTaskByEmail, editSsTask, shareProject, tickSsTask } from "@/app/sstasks/actions";
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
  assignee_ids?: string[];
};
type Person = { id: string; name: string };
type Project = { id: string; name: string; color: string | null; workspace: string; people?: Person[] };
type Tab = "mine" | "by_me";
type View = "list" | "board" | "calendar";
type GroupBy = "project" | "progress" | "due" | "priority" | "assignee";
type Workspace = { id: string; name: string; color: string | null };
type Filter = "late" | "today" | "week" | "high";
type Prefs = { tab: Tab; view: View; groupBy: GroupBy; folded: string[]; lastProject: string | null };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; tasks: Task[]; projects: Project[]; workspaces: Workspace[] };
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
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, days: number) => iso(new Date(utc(s).getTime() + days * 86_400_000));
const monthFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  const [panel, setPanel] = useState<"project" | "share" | null>(null);
  // Full screen: opening the board fills the screen; ✕ or Esc goes back to the panel.
  const [full, setFull] = useState(false);
  // Calendar view: month or week, the day it is anchored on, and per-day "+N more" / "+ add".
  const [calMode, setCalMode] = useState<"month" | "week">("month");
  const [calAnchor, setCalAnchor] = useState<string | null>(null);
  const [moreDay, setMoreDay] = useState<string | null>(null);
  const [addDay, setAddDay] = useState<string | null>(null);
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
      setState({ status: "ready", tasks: body.tasks, projects: body.projects ?? [], workspaces: body.workspaces ?? [] });
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

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[aria-label='Task options'][role=dialog]") && setFull(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full]);

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
  const projects = useMemo(() => (state.status === "ready" ? state.projects : []), [state]);
  const workspaces = state.status === "ready" ? state.workspaces : [];
  // Everyone SS can give tasks to, by id, from the projects' people.
  const peopleById = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of projects) for (const x of p.people ?? []) m.set(x.id, x);
    return m;
  }, [projects]);
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
    if (prefs.groupBy === "assignee") {
      const map = new Map<string, Group>();
      const none: Group = { key: "none", label: "Unassigned", color: GRAY, tasks: [], droppable: false };
      const palette = ["#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6"];
      for (const t of shown) {
        const ids = t.assignee_ids ?? [];
        if (!ids.length) none.tasks.push(t);
        for (const id of ids) {
          const g = map.get(id) ?? { key: id, label: peopleById.get(id)?.name ?? "Someone", color: palette[map.size % palette.length], tasks: [], droppable: true };
          g.tasks.push(t);
          map.set(id, g);
        }
      }
      return [...[...map.values()].sort((a, b) => a.label.localeCompare(b.label)), ...(none.tasks.length ? [none] : [])].map((g) => ({ ...g, tasks: g.tasks.sort(byDue) }));
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
  }, [shown, prefs.groupBy, todayS, weekS, peopleById]);

  // List and board fold separately, so collapsing the list never shrinks the board.
  const foldKey = (g: string) => `${prefs.view}:${prefs.groupBy}:${g}`;
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

  /** "+ Add task" inside a group: the new task takes that group's project, column, due date or priority. */
  async function quickAdd(g: Group, title: string): Promise<string | null> {
    const fallback = projects.some((p) => p.id === prefs.lastProject) ? prefs.lastProject! : projects[0]?.id;
    const project = prefs.groupBy === "project" ? g.key : fallback;
    if (!project) return "No project to add to.";
    const due = prefs.groupBy === "due" ? (g.key === "today" ? todayS : g.key === "week" ? tomorrowS : g.key === "later" ? laterS : null) : null;
    const priority = prefs.groupBy === "priority" && g.key !== "none" ? g.key : null;
    const res = await addSsTask(project, title, due, priority);
    if (!res.ok) return res.error;
    if (prefs.groupBy === "progress" && g.key !== "to do") await editSsTask(res.id, { bucket: g.label });
    if (prefs.groupBy === "assignee" && g.key !== "none") {
      const a = await assignTask(res.id, g.key, true);
      if (!a.ok) setError(a.error);
    }
    if (prefs.tab !== "mine") setPref({ tab: "mine" });
    load(true);
    return null;
  }
  const canAdd = (g: Group) => projects.length > 0 && g.droppable;

  /** Gives the task to someone, or takes it back; shows at once, then reloads. */
  async function assign(task: Task, person: Person, on: boolean) {
    setError(null);
    setState((s) =>
      s.status === "ready"
        ? {
            ...s,
            tasks: s.tasks.map((t) =>
              t.id !== task.id
                ? t
                : {
                    ...t,
                    assignee_ids: on ? [...(t.assignee_ids ?? []), person.id] : (t.assignee_ids ?? []).filter((x) => x !== person.id),
                    assignees: on ? [...t.assignees, person.name] : t.assignees.filter((x) => x !== person.name),
                  },
            ),
          }
        : s,
    );
    mark(task.id, true);
    const res = await assignTask(task.id, person.id, on);
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
      if (t && prefs.groupBy === "assignee") {
        if (g.key !== "none" && !(t.assignee_ids ?? []).includes(g.key)) assign(t, { id: g.key, name: g.label }, true);
        return;
      }
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
            onAssign={(person, on) => assign(t, person, on)}
              onAssigned={() => load(true)}
              appUrl={appUrl}
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
    <section
      className={`flex min-w-0 flex-col bg-surface ${full ? "fixed inset-0 z-[60] overflow-y-auto p-4 sm:p-6" : "rounded-2xl border border-line p-4 shadow-sm"}`}
      aria-modal={full || undefined}
      role={full ? "dialog" : undefined}
      aria-label={full ? "SS Tasks" : undefined}
    >
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
          <button
            type="button"
            onClick={() => {
              setPref({ view: "board" });
              setFull(true);
            }}
            aria-pressed={prefs.view === "board"}
            className={segBtn(prefs.view === "board")}
            title="Board — opens full screen"
          >
            ▦ Board
          </button>
          <button
            type="button"
            onClick={() => {
              setPref({ view: "calendar" });
              setFull(true);
            }}
            aria-pressed={prefs.view === "calendar"}
            className={segBtn(prefs.view === "calendar")}
            title="Calendar — opens full screen"
          >
            📅 Calendar
          </button>
        </div>
        <label className="flex items-center gap-1 text-xs text-muted" title="Group by">
          <span className="hidden 2xl:inline">Group</span>
          <select value={prefs.groupBy} onChange={(e) => setPref({ groupBy: e.target.value as GroupBy })} className="rounded-lg border border-line bg-surface px-1.5 py-1 text-xs text-fg">
            <option value="project">Project</option>
            <option value="progress">Progress</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="assignee">Assigned to</option>
          </select>
        </label>
        {prefs.view === "list" && (
        <button
          type="button"
          onClick={foldAll}
          disabled={!groups.length}
          title={allFolded ? "Expand all groups" : "Collapse all groups"}
          aria-label={allFolded ? "Expand all groups" : "Collapse all groups"}
          className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
        >
          {allFolded ? "⊞" : "⊟"}
        </button>
        )}
        {projects.length > 0 && (
          <button type="button" onClick={() => setAdding((a) => !a)} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90">
            {adding ? "✕ Close" : "+ Task"}
          </button>
        )}
        {workspaces.length > 0 && (
          <button type="button" onClick={() => setPanel((x) => (x === "project" ? null : "project"))} aria-pressed={panel === "project"} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2" title="New project">
            + Project
          </button>
        )}
        {projects.length > 0 && (
          <button type="button" onClick={() => setPanel((x) => (x === "share" ? null : "share"))} aria-pressed={panel === "share"} className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2" title="Share a project by email">
            👥 Share
          </button>
        )}
        <a href={appUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface-2" title="Open SS Tasks">
          Open ↗
        </a>
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          title={full ? "Back to the dashboard (Esc)" : "Full screen"}
          aria-label={full ? "Exit full screen" : "Full screen"}
          className={`rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface-2 ${full ? "bg-surface-2 font-medium" : ""}`}
        >
          {full ? "✕ Close" : "⛶"}
        </button>
      </div>

      {panel === "project" && (
        <NewProject
          workspaces={workspaces}
          onDone={() => {
            setPanel(null);
            load(true);
          }}
        />
      )}
      {panel === "share" && <ShareProject projects={projects} appUrl={appUrl} onChanged={() => load(true)} />}
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
      {state.status === "ready" && shown.length === 0 && prefs.view !== "calendar" && (
        <p className="py-4 text-center text-sm text-muted">
          {filters.size || q ? "No tasks match." : prefs.tab === "mine" ? "Nothing on your plate 🎉" : "No open tasks given to others."}
        </p>
      )}

      {/* List view */}
      {prefs.view === "list" && shown.length > 0 && (
        <div className={`flex-1 space-y-2 overflow-y-auto p-0.5 pr-1 [scrollbar-width:thin] ${full ? "" : "max-h-[34rem]"}`}>
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
                {!folded && canAdd(g) && <InlineAdd onAdd={(title) => quickAdd(g, title)} />}
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
              <div key={g.key} {...dropProps(g)} className={`flex shrink-0 flex-col rounded-xl bg-surface-2/70 transition ${full ? "w-72" : "w-60"} ${dropRing(g)}`} style={{ borderTop: `4px solid ${g.color}` }}>
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
                <ul className={`min-h-16 space-y-2 overflow-y-auto p-2 [scrollbar-width:thin] ${full ? "max-h-[calc(100dvh-17rem)]" : "max-h-[30rem]"}`}>
                  {g.tasks.map((t) => (
                    <li key={t.id}>
                      {row(t, true)}
                    </li>
                  ))}
                  {!g.tasks.length && <li className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-muted">{dragId ? "Drop here" : "No tasks"}</li>}
                </ul>
                {canAdd(g) && <InlineAdd card onAdd={(title) => quickAdd(g, title)} />}
              </div>
            ),
          )}
        </div>
      )}
      {prefs.view === "calendar" && state.status === "ready" && calendar()}
    </section>
  );

  /** Calendar view: tasks on their due dates; drag to another day to change it; unscheduled on the side. */
  function calendar() {
    const anchor = calAnchor ?? todayS;
    const startOf = (s: string) => shift(s, -utc(s).getUTCDay());
    const first = `${anchor.slice(0, 8)}01`;
    const start = calMode === "month" ? startOf(first) : startOf(anchor);
    const days = Array.from({ length: calMode === "month" ? 42 : 7 }, (_, i) => shift(start, i));
    const byDay = new Map<string, Task[]>();
    for (const t of shown) if (t.due) byDay.set(t.due, [...(byDay.get(t.due) ?? []), t]);
    const unscheduled = shown.filter((t) => !t.due);
    const move = (n: number) => {
      if (calMode === "week") return setCalAnchor(shift(anchor, n * 7));
      const d = utc(first);
      d.setUTCMonth(d.getUTCMonth() + n);
      setCalAnchor(iso(d));
    };
    const label =
      calMode === "month"
        ? monthFmt.format(utc(first))
        : `${dueFmt.format(utc(days[0]))} – ${dueFmt.format(utc(days[6]))} ${days[6].slice(0, 4)}`;
    const dropOn = (due: string | null) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!dragId) return;
        e.preventDefault();
        setOver(`cal:${due}`);
      },
      onDragLeave: () => setOver((o) => (o === `cal:${due}` ? null : o)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(null);
        const t = tasks.find((x) => x.id === dragId);
        setDragId(null);
        if (t && t.due !== due) edit(t, { due });
      },
    });
    const ring = (due: string | null) => (over === `cal:${due}` ? "ring-2 ring-inset ring-accent" : "");
    const limit = calMode === "month" ? 3 : 50;

    const chip = (t: Task) => {
      const late = !!t.due && t.due < todayS;
      return (
        <div
          key={t.id}
          {...dragProps(t)}
          className={`group/chip relative flex cursor-grab items-center gap-1 rounded-md py-0.5 pl-1 pr-1.5 text-xs active:cursor-grabbing ${dragId === t.id ? "opacity-40" : ""}`}
          style={{ backgroundColor: tint(t.color || GRAY, 16), borderLeft: `3px solid ${t.color || GRAY}` }}
          title={`${t.title} · ${t.project}`}
        >
          <button
            type="button"
            onClick={() => tick(t)}
            disabled={busy.has(t.id)}
            aria-label={`Mark "${t.title}" done`}
            className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[8px] text-transparent opacity-60 hover:text-emerald-600 hover:opacity-100"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu((m) => (m?.id === t.id ? null : { id: t.id, rect }));
            }}
            className={`min-w-0 flex-1 truncate text-left font-medium ${late ? "text-red-700 dark:text-red-300" : ""}`}
          >
            {t.priority === "urgent" && <span className="text-red-600">! </span>}
            {t.title}
          </button>
          {menu?.id === t.id && (
            <TaskMenu
              anchor={menu.rect}
              task={t}
              projects={projects}
              dates={{ today: todayS, tomorrow: tomorrowS, nextWeek: nextWeekS }}
              onEdit={(patch) => edit(t, patch)}
              onAssign={(person, on) => assign(t, person, on)}
              onAssigned={() => load(true)}
              appUrl={appUrl}
              onClose={() => setMenu(null)}
              openHref={href(t)}
            />
          )}
        </div>
      );
    };

    async function addOn(day: string, title: string) {
      const fallback = projects.some((p) => p.id === prefs.lastProject) ? prefs.lastProject! : projects[0]?.id;
      if (!fallback) return "No project to add to.";
      const res = await addSsTask(fallback, title, day, null);
      if (!res.ok) return res.error;
      if (prefs.tab !== "mine") setPref({ tab: "mine" });
      load(true);
      return null;
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCalAnchor(null)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2">
              Today
            </button>
            <button type="button" onClick={() => move(-1)} aria-label="Previous" className="rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
              ‹
            </button>
            <button type="button" onClick={() => move(1)} aria-label="Next" className="rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
              ›
            </button>
            <span className="text-sm font-semibold">{label}</span>
            <div className="ml-auto flex rounded-xl bg-surface-2 p-0.5">
              {(["week", "month"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setCalMode(m)} aria-pressed={calMode === m} className={segBtn(calMode === m)}>
                  {m === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-7 border-b border-line bg-surface-2/60 text-center text-xs font-medium text-muted">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1.5">
                  <span className="hidden sm:inline">{d}</span>
                  <span className="sm:hidden">{d.slice(0, 2)}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const items = (byDay.get(day) ?? []).sort((a, b) => a.title.localeCompare(b.title));
                const inMonth = calMode === "week" || day.slice(0, 7) === first.slice(0, 7);
                const isToday = day === todayS;
                const all = moreDay === day;
                return (
                  <div
                    key={day}
                    {...dropOn(day)}
                    className={`group/day relative flex flex-col gap-1 border-b border-r border-line/70 p-1 [&:nth-child(7n)]:border-r-0 ${
                      calMode === "month" ? (full ? "min-h-[7.5rem]" : "min-h-[6rem]") : "min-h-[22rem]"
                    } ${inMonth ? "" : "bg-surface-2/40 text-muted"} ${isToday ? "bg-accent/5" : ""} ${ring(day)}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`flex size-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-accent font-semibold text-white" : ""}`}
                      >
                        {Number(day.slice(8))}
                      </span>
                      {projects.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAddDay(addDay === day ? null : day)}
                          aria-label={`Add a task on ${day}`}
                          title="Add a task on this day"
                          className="rounded px-1 text-sm leading-none text-accent opacity-0 hover:bg-surface-2 group-hover/day:opacity-100 focus:opacity-100"
                        >
                          +
                        </button>
                      )}
                    </div>
                    {(all ? items : items.slice(0, limit)).map(chip)}
                    {items.length > limit && (
                      <button type="button" onClick={() => setMoreDay(all ? null : day)} className="text-left text-[11px] text-muted hover:text-fg">
                        {all ? "Show less" : `+${items.length - limit} more`}
                      </button>
                    )}
                    {addDay === day && <DayAdd onAdd={(title) => addOn(day, title)} onClose={() => setAddDay(null)} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Unscheduled: drop here to clear a due date. */}
        <aside {...dropOn(null)} className={`flex w-full shrink-0 flex-col rounded-xl bg-surface-2/70 lg:w-64 ${ring(null)}`}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-sm font-semibold">Unscheduled</span>
            <span className="ml-auto rounded-full bg-surface/80 px-1.5 text-xs text-muted">{unscheduled.length}</span>
          </div>
          <ul className={`space-y-2 overflow-y-auto p-2 [scrollbar-width:thin] ${full ? "max-h-[calc(100dvh-14rem)]" : "max-h-[30rem]"}`}>
            {unscheduled.map((t) => (
              <li key={t.id}>{row(t, true)}</li>
            ))}
            {!unscheduled.length && <li className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-muted">No tasks without a date</li>}
          </ul>
          {projects.length > 0 && <InlineAdd card onAdd={(title) => addOn("", title)} />}
        </aside>
      </div>
    );
  }
}

/** "+" on a calendar day: a one-line box for a task due that day. */
function DayAdd({ onAdd, onClose }: { onAdd: (title: string) => Promise<string | null>; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        const err = await onAdd(title.trim());
        setBusy(false);
        if (err) setError(err);
        else onClose();
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onBlur={() => !title.trim() && onClose()}
        placeholder="New task…"
        disabled={busy}
        maxLength={300}
        className="w-full rounded-md border border-accent bg-surface px-1.5 py-0.5 text-xs"
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </form>
  );
}

/** "+ Add task" at the foot of a group or board column: type a title, Enter adds it. */
function InlineAdd({ onAdd, card = false }: { onAdd: (title: string) => Promise<string | null>; card?: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    const err = await onAdd(t);
    setBusy(false);
    if (err) return setError(err);
    setTitle(""); // stays open for the next one
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-1.5 text-left text-xs font-medium text-accent hover:bg-surface-2 ${card ? "rounded-b-xl px-3 py-2" : "border-t border-line/50 px-3 py-1.5"}`}
      >
        <span className="text-base leading-none">+</span> Add task
      </button>
    );
  return (
    <form onSubmit={submit} className={`space-y-1 ${card ? "px-2 pb-2" : "border-t border-line/50 px-3 py-1.5"}`}>
      <div className="flex gap-1.5">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setTitle(""))}
          placeholder="Task name, then Enter"
          maxLength={300}
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm"
        />
        <button type="submit" disabled={busy || !title.trim()} className="rounded-lg bg-accent px-2.5 text-xs font-medium text-white disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
        <button type="button" onClick={() => (setOpen(false), setTitle(""))} aria-label="Cancel" className="px-1 text-muted hover:text-fg">
          ✕
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

/** ⋯ on a task: due date, priority, progress and project, applied at once. */
function TaskMenu({
  anchor,
  task,
  projects,
  dates,
  onEdit,
  onAssign,
  onAssigned,
  appUrl,
  onClose,
  openHref,
}: {
  anchor: DOMRect;
  task: Task;
  projects: Project[];
  dates: { today: string; tomorrow: string; nextWeek: string };
  onEdit: (patch: Patch) => void;
  onAssign: (person: Person, on: boolean) => void;
  onAssigned: () => void;
  appUrl: string;
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
  const people = projects.find((p) => p.id === task.project_id)?.people ?? [];
  const quick = "rounded-full border border-line px-2 py-0.5 text-xs hover:bg-surface-2";
  const label = "text-[11px] font-semibold uppercase tracking-wide text-muted";
  const progress = (task.bucket ?? "To do").toLowerCase();

  return (
    <div ref={ref} role="dialog" aria-label="Task options" style={pos} className="fixed z-[70] max-h-[85vh] w-[264px] space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-sm shadow-xl" draggable={false}>
      <div className="space-y-1.5">
        <p className={label}>Assigned to</p>
        {people.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {people.map((p) => {
              const on = (task.assignee_ids ?? []).includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onAssign(p, !on)}
                  title={on ? `Take back from ${p.name}` : `Assign to ${p.name}`}
                  className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs ${on ? "bg-accent text-white" : "border border-line hover:bg-surface-2"}`}
                >
                  <span className={`flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ${on ? "bg-white/25" : "bg-surface-2"}`}>
                    {p.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  {p.name.split(/\s+/)[0]}
                  {on && " ✓"}
                </button>
              );
            })}
          </div>
        )}
        <AssignByEmail taskId={task.id} appUrl={appUrl} onAssigned={onAssigned} />
      </div>
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

/** Shows an invite link with Copy and WhatsApp buttons. */
function InviteLink({ appUrl, token, email }: { appUrl: string; token: string; email: string }) {
  const link = `${appUrl.replace(/\/$/, "")}/join/${token}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
      <p>
        <b>{email}</b> is not in SS Tasks yet. Send them this link — it is theirs as soon as they join:
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
          href={`https://wa.me/?text=${encodeURIComponent(`You've been added to SS Tasks. Join here: ${link}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-line px-2 py-0.5 text-fg hover:bg-surface"
        >
          WhatsApp
        </a>
      </div>
    </div>
  );
}

type Msg = { ok: string } | { error: string } | { invite: { token: string; email: string } } | null;

/** "Assign by email" inside the task menu. */
function AssignByEmail({ taskId, appUrl, onAssigned }: { taskId: string; appUrl: string; onAssigned: () => void }) {
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

const PROJECT_COLORS = ["#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6", "#64748b"];

/** "+ Project": name, workspace and colour. */
function NewProject({ workspaces, onDone }: { workspaces: Workspace[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [ws, setWs] = useState(workspaces[0]?.id ?? "");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError(null);
        const res = await addSsProject(ws, name, color);
        setBusy(false);
        if (!res.ok) return setError(res.error);
        onDone();
      }}
      className="mb-3 space-y-2 rounded-xl border border-line bg-surface-2/60 p-2"
    >
      <div className="flex flex-wrap gap-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name…" maxLength={120} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
        <select value={ws} onChange={(e) => setWs(e.target.value)} aria-label="Workspace" className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            className={`size-6 rounded-full ${color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <button type="submit" disabled={busy || !name.trim()} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

/** "Share": give someone access to a project by email (or an invite link). */
function ShareProject({ projects, appUrl, onChanged }: { projects: Project[]; appUrl: string; onChanged: () => void }) {
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const workspaces = [...new Set(projects.map((p) => p.workspace))];
  const people = projects.find((p) => p.id === project)?.people ?? [];
  return (
    <div className="mb-3 space-y-2 rounded-xl border border-line bg-surface-2/60 p-2">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.trim() || busy) return;
          setBusy(true);
          setMsg(null);
          const res = await shareProject(project, email);
          setBusy(false);
          if (!res.ok) return setMsg({ error: res.error });
          if (res.data.status === "added") {
            setMsg({ ok: `${res.data.name} can now see this project.` });
            setEmail("");
          } else setMsg({ invite: { token: res.data.token, email: res.data.email } });
          onChanged();
        }}
        className="flex flex-wrap gap-2"
      >
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
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
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email to share with…" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
        <button type="submit" disabled={busy || !email.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Sharing…" : "Share"}
        </button>
      </form>
      {people.length > 0 && <p className="text-xs text-muted">On this project: {people.map((p) => p.name).join(", ")}</p>}
      {msg && "ok" in msg && <p className="text-xs text-up">{msg.ok}</p>}
      {msg && "error" in msg && <p className="text-xs text-danger">{msg.error}</p>}
      {msg && "invite" in msg && <InviteLink appUrl={appUrl} token={msg.invite.token} email={msg.invite.email} />}
    </div>
  );
}
