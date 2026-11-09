"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addTodoSubtask, addTodoTask, createTodoList, deleteTodoList, deleteTodoTask, moveTodoTask, setTodoListOrder, setTodoTaskPriority, setTodoListColor, setTodoTaskColor, setTodoTaskDone, updateTodoTask } from "@/app/todo/actions";
import { toRomanUrdu } from "@/lib/roman-urdu";
import { karachiToday, addDays } from "@/lib/time";
import type { ListColor, NoteColor, TaskPriority, TodoList, TodoTask } from "@/lib/types";
import { savedDictationLang, useDictation, type DictationLang } from "./dictation";
import { onDashboardRefresh } from "@/lib/refresh-event";

const REFRESH_MS = 5 * 60 * 1000;
const FOLDED_KEY = "dashboard.foldedLists";
const OPEN_URL = { google: "https://tasks.google.com/", microsoft: "https://to-do.live.com/tasks/" } as const;

// The same colours as sticky notes.
const TASK_COLORS: { key: NoteColor; row: string; dot: string }[] = [
  { key: "yellow", row: "bg-amber-100 dark:bg-amber-950/50", dot: "bg-amber-300" },
  { key: "pink", row: "bg-rose-100 dark:bg-rose-950/50", dot: "bg-rose-300" },
  { key: "green", row: "bg-emerald-100 dark:bg-emerald-950/50", dot: "bg-emerald-300" },
  { key: "blue", row: "bg-sky-100 dark:bg-sky-950/50", dot: "bg-sky-300" },
  { key: "purple", row: "bg-violet-100 dark:bg-violet-950/50", dot: "bg-violet-300" },
  { key: "orange", row: "bg-orange-100 dark:bg-orange-950/50", dot: "bg-orange-300" },
];
const rowColor = (c?: NoteColor | null) => TASK_COLORS.find((x) => x.key === c)?.row;

type Provider = keyof typeof OPEN_URL;
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "disconnected"; reconnect: boolean }
  | { status: "ready"; provider: Provider; lists: TodoList[]; tasks: TodoTask[] };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = ({ y, m, d }: { y: number; m: number; d: number }) => `${y}-${pad(m)}-${pad(d)}`;
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const nowHm = () => hmFmt.format(new Date());
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

// Soft heading strips for lists; each list can pick its own (🎨), else they go in order.
const LIST_COLORS: { key: ListColor; band: string; dot: string }[] = [
  { key: "blue", band: "bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-100", dot: "bg-sky-300" },
  { key: "purple", band: "bg-violet-100 text-violet-900 dark:bg-violet-950/70 dark:text-violet-100", dot: "bg-violet-300" },
  { key: "green", band: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-100", dot: "bg-emerald-300" },
  { key: "yellow", band: "bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-100", dot: "bg-amber-300" },
  { key: "pink", band: "bg-rose-100 text-rose-900 dark:bg-rose-950/70 dark:text-rose-100", dot: "bg-rose-300" },
  { key: "teal", band: "bg-teal-100 text-teal-900 dark:bg-teal-950/70 dark:text-teal-100", dot: "bg-teal-300" },
  { key: "orange", band: "bg-orange-100 text-orange-900 dark:bg-orange-950/70 dark:text-orange-100", dot: "bg-orange-300" },
  { key: "indigo", band: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-100", dot: "bg-indigo-300" },
  { key: "red", band: "bg-red-100 text-red-900 dark:bg-red-950/70 dark:text-red-100", dot: "bg-red-300" },
  { key: "gray", band: "bg-slate-100 text-slate-800 dark:bg-slate-800/70 dark:text-slate-100", dot: "bg-slate-300" },
];
const listColor = (list: TodoList, i: number) => LIST_COLORS.find((c) => c.key === list.color) ?? LIST_COLORS[i % LIST_COLORS.length];


// Planner-style priority, kept by the dashboard.
const PRIORITIES: { key: TaskPriority; label: string; chip: string; dot: string }[] = [
  { key: "urgent", label: "Urgent", chip: "bg-red-600 text-white", dot: "bg-red-600" },
  { key: "important", label: "Important", chip: "bg-orange-500 text-white", dot: "bg-orange-500" },
  { key: "medium", label: "Medium", chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200", dot: "bg-sky-400" },
  { key: "low", label: "Low", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
];
const priorityOf = (p?: TaskPriority | null) => PRIORITIES.find((x) => x.key === p);

type BoardGroup = "list" | "priority" | "due";
const GROUP_KEY = "dashboard.boardGroup";

// The task being dragged (HTML drag and drop carries only text, so the task itself is kept here).
let dragged: TodoTask | null = null;

/** Drop target props, and whether a task is hovering over it. */
function useDrop(onDrop?: (t: TodoTask) => void) {
  const [over, setOver] = useState(false);
  if (!onDrop) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const t = dragged;
        dragged = null;
        if (t) onDrop(t);
      },
    },
  };
}

// Reminder choices: minutes before the due time (null = none).
const REMINDERS: { value: number | null; label: string }[] = [
  { value: null, label: "No reminder" },
  { value: 0, label: "At the time" },
  { value: 5, label: "5 min before" },
  { value: 10, label: "10 min before" },
  { value: 15, label: "15 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 1440, label: "1 day before" },
];
const DEFAULT_REMIND = 10;
const NOTIFIED_KEY = "dashboard.taskNotified";

/** Asks once for permission to show reminders as browser notifications. */
function askNotifyPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

/**
 * While the dashboard is open, rings each reminder as a browser notification
 * (the phone gets the same reminder from Google Calendar). Each one rings once,
 * remembered in this browser, and only up to 2 hours late.
 */
function useTaskNotifications(tasks: TodoTask[], isDone: (t: TodoTask) => boolean) {
  const latest = useRef({ tasks, isDone });
  latest.current = { tasks, isDone };
  useEffect(() => {
    function check() {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      let seen: string[] = [];
      try {
        seen = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]");
      } catch {}
      const now = Date.now();
      let changed = false;
      for (const t of latest.current.tasks) {
        if (!t.due || !t.time || t.remind === null || t.remind === undefined || latest.current.isDone(t)) continue;
        // Karachi is UTC+5 all year.
        const dueAt = Date.parse(`${t.due}T${t.time}:00+05:00`);
        const ringAt = dueAt - t.remind * 60_000;
        const key = `${t.id}@${t.due}T${t.time}-${t.remind}`;
        if (now < ringAt || now > dueAt + 2 * 3600_000 || seen.includes(key)) continue;
        try {
          const n = new Notification(`⏰ ${t.title}`, {
            body: `${t.remind === 0 ? "Now" : `At ${clock(t.time)}`} · ${t.listName}`,
            tag: key,
            icon: "/logos/ss-dashboard-512.png",
          });
          n.onclick = () => window.focus();
        } catch {}
        seen.push(key);
        changed = true;
      }
      if (changed) {
        try {
          localStorage.setItem(NOTIFIED_KEY, JSON.stringify(seen.slice(-200)));
        } catch {}
      }
    }
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);
}

/** "15:30" → "3:30 PM". */
function clock(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The chip in front of a task: its due date (and time), red when past. */
function dueLabel(due: string, time: string | null | undefined, dates: Dates, nowHm: string) {
  const day = due === dates.today ? "Today" : due === dates.tomorrow ? "Tomorrow" : dueFmt.format(new Date(`${due}T00:00:00Z`));
  const text = time ? `${day} · ${clock(time)}` : day;
  const late = due < dates.today || (due === dates.today && !!time && time < nowHm);
  if (late) return { text, chip: "border-danger/40 bg-danger-soft text-danger" };
  if (due === dates.today) return { text, chip: "border-accent/40 bg-accent/10 text-accent" };
  return { text, chip: "border-line text-muted" };
}

type Dates = { today: string; tomorrow: string; now: string }; // now: HH:MM in Karachi

/** Open tasks from Google Tasks (or Microsoft To Do), grouped by list the way Google shows them. */
export function Todos() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  // Ticks not yet confirmed by a reload: task id → done.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [detail, setDetail] = useState<TodoTask | null>(null);
  const [board, setBoard] = useState(false);
  const [group, setGroup] = useState<BoardGroup>("list");
  useEffect(() => {
    try {
      const g = localStorage.getItem(GROUP_KEY);
      if (g === "list" || g === "priority" || g === "due") setGroup(g);
    } catch {}
  }, []);
  function chooseGroup(g: BoardGroup) {
    setGroup(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {}
  }
  // Lists folded in the panel, remembered in this browser.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setFolded(new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]")));
    } catch {}
  }, []);
  const saveFolded = (next: Set<string>) => {
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
    } catch {}
  };
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/todo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.connected) return setState({ status: "disconnected", reconnect: Boolean(body.googleNeedsReconnect) });
      setState({ status: "ready", provider: body.provider, lists: body.lists, tasks: body.tasks });
      setOverrides(new Map());
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load" });
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const off = onDashboardRefresh(load);
    return () => {
      clearInterval(t);
      off();
    };
  }, [load]);

  useEffect(() => {
    if (!board) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !detail && setBoard(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, detail]);

  // Asks for a name and makes the list in Google Tasks.
  function newList() {
    const name = window.prompt("New list name");
    if (!name?.trim()) return;
    setError(null);
    start(async () => {
      const res = await createTodoList(name);
      if (!res.ok) return setError(res.error);
      await load();
    });
  }

  async function add(listId: string, title: string, due: string | null, time: string | null, remind: number | null): Promise<string | null> {
    const res = await addTodoTask(listId, title, due, time, remind);
    if (!res.ok) return res.error;
    await load();
    return null;
  }

  const isDone = (t: TodoTask) => overrides.get(t.id) ?? t.done;

  function setDoneLocal(id: string, value: boolean | undefined) {
    setOverrides((m) => {
      const copy = new Map(m);
      if (value === undefined) copy.delete(id);
      else copy.set(id, value);
      return copy;
    });
  }

  // Ticking moves the task to its list's "Completed" (and back); only the checkbox does this.
  function toggle(task: TodoTask) {
    const next = !isDone(task);
    setDoneLocal(task.id, next);
    start(async () => {
      const res = await setTodoTaskDone(task.listId, task.id, next, { title: task.title, due: task.due });
      if (!res.ok) {
        setError(res.error);
        setDoneLocal(task.id, undefined);
      }
    });
  }

  useTaskNotifications(state.status === "ready" ? state.tasks : [], isDone);
  const [canNotify, setCanNotify] = useState<NotificationPermission | "unsupported">("granted");
  useEffect(() => setCanNotify(typeof Notification === "undefined" ? "unsupported" : Notification.permission), []);
  const hasReminders = state.status === "ready" && state.tasks.some((t) => t.remind !== null && t.remind !== undefined);

  // An open task detail follows reloads (checklist, priority) of the same task.
  useEffect(() => {
    if (state.status !== "ready") return;
    setDetail((d) => {
      if (!d) return d;
      const fresh = state.tasks.find((t) => t.id === d.id);
      return fresh && JSON.stringify(fresh) !== JSON.stringify(d) ? fresh : d;
    });
  }, [state]);

  // Dropping a task on another list moves it there.
  function dropToList(task: TodoTask, listId: string) {
    if (task.listId === listId || state.status !== "ready" || state.provider !== "google") return;
    const name = state.lists.find((l) => l.id === listId)?.name ?? "";
    setState((s) => (s.status === "ready" ? { ...s, tasks: s.tasks.map((x) => (x.id === task.id ? { ...x, listId, listName: name } : x)) } : s));
    setError(null);
    start(async () => {
      const res = await moveTodoTask(task.listId, task.id, listId);
      if (!res.ok) setError(res.error);
      await load();
    });
  }

  // Priority, shown at once and saved; put back if saving fails.
  function setPriority(task: TodoTask, priority: TaskPriority | null) {
    const before = task.priority ?? null;
    const paint = (p: TaskPriority | null) => {
      setState((s) => (s.status === "ready" ? { ...s, tasks: s.tasks.map((x) => (x.id === task.id ? { ...x, priority: p } : x)) } : s));
      setDetail((d) => (d && d.id === task.id ? { ...d, priority: p } : d));
    };
    paint(priority);
    start(async () => {
      const res = await setTodoTaskPriority(task.id, priority);
      if (!res.ok) {
        setError(res.error);
        paint(before);
      }
    });
  }

  // ▲ ▼ on a list: swaps it with its neighbour and saves the order.
  function moveList(i: number, dir: -1 | 1) {
    if (state.status !== "ready") return;
    const j = i + dir;
    if (j < 0 || j >= state.lists.length) return;
    const lists = [...state.lists];
    [lists[i], lists[j]] = [lists[j], lists[i]];
    setState({ ...state, lists });
    start(async () => {
      const res = await setTodoListOrder(lists.map((l) => l.id));
      if (!res.ok) {
        setError(res.error);
        await load();
      }
    });
  }

  // Deletes a list and its tasks in Google Tasks, after asking.
  function removeList(list: TodoList) {
    const n = state.status === "ready" ? state.tasks.filter((t) => t.listId === list.id && !t.done).length : 0;
    if (!confirm(`Delete the list "${list.name}"${n ? ` and its ${n} open task${n === 1 ? "" : "s"}` : ""}? This can't be undone.`)) return;
    setError(null);
    start(async () => {
      const res = await deleteTodoList(list.id);
      if (!res.ok) return setError(res.error);
      await load();
    });
  }

  function paintList(listId: string, color: ListColor | null) {
    const before = state.status === "ready" ? (state.lists.find((l) => l.id === listId)?.color ?? null) : null;
    const paint = (c: ListColor | null) =>
      setState((s) => (s.status === "ready" ? { ...s, lists: s.lists.map((l) => (l.id === listId ? { ...l, color: c } : l)) } : s));
    paint(color);
    start(async () => {
      const res = await setTodoListColor(listId, color);
      if (!res.ok) {
        setError(res.error);
        paint(before);
      }
    });
  }

  const dates: Dates = { today: ymd(karachiToday()), tomorrow: ymd(addDays(karachiToday(), 1)), now: nowHm() };
  const ready = state.status === "ready" ? state : null;
  const sections = (layout: "stack" | "board") =>
    ready!.lists.map((list, i) => (
      <ListSection
        key={list.id}
        layout={layout}
        color={listColor(list, i)}
        onColor={(c) => paintList(list.id, c)}
        onDelete={ready!.provider === "google" && !list.isDefault ? () => removeList(list) : undefined}
        onMove={(dir) => moveList(i, dir)}
        onDropTask={ready!.provider === "google" ? (t) => dropToList(t, list.id) : undefined}
        folded={layout === "stack" && folded.has(list.id)}
        onFold={() => {
          const next = new Set(folded);
          if (next.has(list.id)) next.delete(list.id);
          else next.add(list.id);
          saveFolded(next);
        }}
        canUp={i > 0}
        canDown={i < ready!.lists.length - 1}
        list={list}
        tasks={ready!.tasks.filter((t) => t.listId === list.id)}
        isDone={isDone}
        dates={dates}
        onToggle={toggle}
        onOpen={setDetail}
        onAdd={add}
      />
    ));

  const headerButtons = (inBoard: boolean) => (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs [&>*]:whitespace-nowrap">
      {ready?.provider === "google" && (
        <button type="button" onClick={newList} disabled={pending} className="text-muted hover:text-fg">
          + List
        </button>
      )}
      {ready && !inBoard && ready.lists.length > 1 && (
        <button
          type="button"
          onClick={() => saveFolded(ready.lists.every((l) => folded.has(l.id)) ? new Set() : new Set(ready.lists.map((l) => l.id)))}
          className="text-muted hover:text-fg"
          title={ready.lists.every((l) => folded.has(l.id)) ? "Open every list" : "Fold every list to its heading"}
        >
          {ready.lists.every((l) => folded.has(l.id)) ? "⊞ Expand" : "⊟ Collapse"}
        </button>
      )}
      <button type="button" onClick={load} className="text-muted hover:text-fg" aria-label="Refresh tasks">
        ↻
      </button>
      {hasReminders && canNotify === "default" && (
        <button
          type="button"
          onClick={() => Notification.requestPermission().then(setCanNotify).catch(() => {})}
          className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          title="Show reminders as notifications on this computer"
        >
          🔔 Alerts
        </button>
      )}
      {ready && !inBoard && (
        <button type="button" onClick={() => setBoard(true)} className="text-muted hover:text-fg" title="All lists side by side">
          ⤢ Board
        </button>
      )}
      <a href={OPEN_URL[ready?.provider ?? "google"]} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-fg">
        Open ↗
      </a>
      {inBoard && (
        <button type="button" onClick={() => setBoard(false)} aria-label="Close board" className="ml-1 grid size-8 place-items-center rounded-full text-base text-muted hover:bg-surface-2 hover:text-fg">
          ✕
        </button>
      )}
    </div>
  );

  const title = (
    <h2 className="flex items-center gap-2 font-semibold">
      <span className="grid size-6 place-items-center rounded-md bg-[#1a73e8] text-xs text-white">✓</span>
      Tasks
    </h2>
  );

  const errorLine = error && (
    <p className="mb-2 rounded-lg bg-danger-soft px-2 py-1 text-xs text-danger" role="alert">
      {error}
    </p>
  );

  return (
    <section className="h-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        {title}
        {headerButtons(false)}
      </div>

      {state.status === "disconnected" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            {state.reconnect
              ? "Reconnect Google once to allow Google Tasks, then your lists show here."
              : "Connect Google to see and add your Google Tasks here."}
          </p>
          <a href="/api/google/connect" className="inline-block rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            {state.reconnect ? "Reconnect Google" : "Connect Google"}
          </a>
        </div>
      ) : state.status === "loading" ? (
        <div className="space-y-2" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          Couldn’t load tasks: {state.message}
        </p>
      ) : (
        <>
          {!board && errorLine}
          {state.lists.length === 0 ? (
            <p className="py-2 text-sm text-muted">No lists yet — use + List to make one.</p>
          ) : (
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">{sections("stack")}</div>
          )}

          {board && (
            <div role="dialog" aria-modal="true" aria-label="Tasks board" className="fixed inset-0 z-40 flex flex-col bg-bg">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
                {title}
                {headerButtons(true)}
              </div>
              <BoardBar
                tasks={state.tasks}
                isDone={isDone}
                dates={dates}
                group={group}
                onGroup={chooseGroup}
              />
              {error && <div className="px-4 pt-3">{errorLine}</div>}
              <div className="flex flex-1 items-start gap-4 overflow-x-auto p-4">
                {group === "list" ? (
                  sections("board")
                ) : (
                  <GroupColumns
                    group={group}
                    tasks={state.tasks}
                    isDone={isDone}
                    dates={dates}
                    onToggle={toggle}
                    onOpen={setDetail}
                    onPriority={setPriority}
                  />
                )}
              </div>
            </div>
          )}

          {detail && (
            <TaskDetail
              task={detail}
              onPriority={(p) => setPriority(detail, p)}
              onChecklist={async () => {
                await load();
              }}
              lists={state.provider === "google" ? state.lists : []}
              onMove={async (toListId) => {
                const res = await moveTodoTask(detail.listId, detail.id, toListId);
                if (!res.ok) return res.error;
                setDetail(null);
                await load();
                return null;
              }}
              done={isDone(detail)}
              openUrl={OPEN_URL[state.provider]}
              onClose={() => setDetail(null)}
              onToggle={() => {
                toggle(detail);
                setDetail(null);
              }}
              onSaved={async () => {
                setDetail(null);
                await load();
              }}
              onColor={(color) => {
                const id = detail.id;
                const before = detail.color ?? null;
                const paint = (c: NoteColor | null) => {
                  setState((s) => (s.status === "ready" ? { ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, color: c } : x)) } : s));
                  setDetail((d) => (d && d.id === id ? { ...d, color: c } : d));
                };
                paint(color);
                start(async () => {
                  const res = await setTodoTaskColor(id, color);
                  if (!res.ok) {
                    setError(res.error);
                    paint(before);
                  }
                });
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

/** One list: its name, "Add a task", its open tasks and a folded "Completed" — like a Google Tasks card. */
function ListSection({
  layout,
  list,
  tasks,
  isDone,
  dates,
  onToggle,
  onOpen,
  onAdd,
  color,
  onColor,
  onDelete,
  onMove,
  canUp,
  canDown,
  folded,
  onFold,
  onDropTask,
}: {
  onDropTask?: (t: TodoTask) => void;
  folded: boolean;
  onFold: () => void;
  color: (typeof LIST_COLORS)[number];
  onColor: (c: ListColor | null) => void;
  onDelete?: () => void;
  onMove: (dir: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
  layout: "stack" | "board";
  list: TodoList;
  tasks: TodoTask[];
  isDone: (t: TodoTask) => boolean;
  dates: Dates;
  onToggle: (t: TodoTask) => void;
  onOpen: (t: TodoTask) => void;
  onAdd: (listId: string, title: string, due: string | null, time: string | null, remind: number | null) => Promise<string | null>;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [picking, setPicking] = useState(false);
  const open = tasks.filter((t) => !isDone(t));
  const finished = tasks.filter((t) => isDone(t));
  const board = layout === "board";
  const drop = useDrop(onDropTask);

  return (
    <div
      {...drop.props}
      className={`${
        board
          ? "flex max-h-full w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
          : "overflow-hidden rounded-xl border border-line/70"
      } ${drop.over ? "ring-2 ring-accent ring-offset-1" : ""}`}
    >
      <div className={`flex items-center gap-1 ${color.band} ${board ? "px-4 py-2" : "px-2.5 py-1"}`}>
        <button
          type="button"
          onClick={() => !board && onFold()}
          aria-expanded={board ? undefined : !folded}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left font-semibold ${board ? "cursor-default text-lg" : "text-sm"}`}
        >
          {!board && <span className="w-3 text-xs opacity-60">{folded ? "▸" : "▾"}</span>}
          <span className="min-w-0 flex-1 truncate">{list.name}</span>
          {open.length > 0 && <span className="rounded-full bg-white/60 px-1.5 text-xs font-medium dark:bg-black/20">{open.length}</span>}
        </button>
        {(canUp || canDown) && (
          <span className="flex shrink-0 items-center opacity-60 hover:opacity-100">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={!canUp}
              aria-label={`Move ${list.name} ${board ? "left" : "up"}`}
              title={board ? "Move left" : "Move up"}
              className="grid size-6 place-items-center rounded-full text-[11px] hover:bg-white/50 disabled:opacity-30 dark:hover:bg-black/20"
            >
              {board ? "◀" : "▲"}
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={!canDown}
              aria-label={`Move ${list.name} ${board ? "right" : "down"}`}
              title={board ? "Move right" : "Move down"}
              className="grid size-6 place-items-center rounded-full text-[11px] hover:bg-white/50 disabled:opacity-30 dark:hover:bg-black/20"
            >
              {board ? "▶" : "▼"}
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          aria-label={`Colour for ${list.name}`}
          aria-expanded={picking}
          title={onDelete ? "Colour / delete list" : "Heading colour"}
          className="grid size-6 shrink-0 place-items-center rounded-full text-xs opacity-60 hover:bg-white/50 hover:opacity-100 dark:hover:bg-black/20"
        >
          🎨
        </button>
      </div>
      {picking && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-2" role="group" aria-label="Heading colour">
          {LIST_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                onColor(c.key);
                setPicking(false);
              }}
              aria-label={c.key}
              aria-pressed={color.key === c.key}
              className={`size-6 rounded-full ${c.dot} ${color.key === c.key ? "ring-2 ring-fg ring-offset-1 ring-offset-surface" : ""}`}
            />
          ))}
          {list.color && (
            <button type="button" onClick={() => (onColor(null), setPicking(false))} className="ml-1 text-xs text-muted hover:text-fg">
              Auto
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => (setPicking(false), onDelete())}
              className="ml-auto rounded-lg px-2 py-0.5 text-xs text-danger hover:bg-danger-soft"
            >
              🗑 Delete list
            </button>
          )}
        </div>
      )}
      {!folded && (
        <div className={board ? "min-h-0 flex-1 overflow-y-auto p-3 pr-2" : "p-2"}>
          <AddTask onAdd={(title, due, time, remind) => onAdd(list.id, title, due, time, remind)} />
          {open.length === 0 ? (
            <p className="px-1.5 py-1.5 text-xs text-muted">{finished.length ? "All done 🎉" : "No tasks yet"}</p>
          ) : (
            <ul className="space-y-0.5">
              {open.map((t) => (
                <TaskRow key={t.id} task={t} done={false} dates={dates} onToggle={onToggle} onOpen={onOpen} draggable={!!onDropTask} />
              ))}
            </ul>
          )}
          {finished.length > 0 && (
            <div className="mt-1.5 border-t border-line pt-1">
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                aria-expanded={showCompleted}
                className="px-1.5 py-1 text-xs font-medium text-muted hover:text-fg"
              >
                {showCompleted ? "▾" : "▸"} Completed ({finished.length})
              </button>
              {showCompleted && (
                <ul className="space-y-0.5">
                  {finished.map((t) => (
                    <TaskRow key={t.id} task={t} done dates={dates} onToggle={onToggle} onOpen={onOpen} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task: t,
  done,
  dates,
  onToggle,
  onOpen,
  draggable,
  showList,
}: {
  task: TodoTask;
  done: boolean;
  dates: Dates;
  onToggle: (t: TodoTask) => void;
  onOpen: (t: TodoTask) => void;
  draggable?: boolean;
  showList?: boolean;
}) {
  const label = t.due && !done ? dueLabel(t.due, t.time, dates, dates.now) : null;
  const pri = priorityOf(t.priority);
  const checks = t.subtasks ?? [];
  const checked = checks.filter((c) => c.done).length;
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        dragged = t;
        e.dataTransfer.setData("text/plain", t.title);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (dragged = null)}
      className={`flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 ${rowColor(t.color) ?? "hover:bg-surface-2"} ${t.color ? "mb-0.5 hover:brightness-95" : ""} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(t)}
        aria-label={done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#1a73e8]"
      />
      <button type="button" onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left" dir="auto">
        <span className={`block text-sm ${done ? "text-muted line-through" : ""}`}>
          {t.important && <span className="mr-1 text-amber-500" aria-label="Important">★</span>}
          {t.title}
        </span>
        {(pri || checks.length > 0 || showList || t.notes) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {pri && !done && <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${pri.chip}`}>{pri.label}</span>}
            {checks.length > 0 && (
              <span className={checked === checks.length ? "text-emerald-600 dark:text-emerald-400" : ""} title="Checklist">
                ☑ {checked}/{checks.length}
              </span>
            )}
            {showList && <span>{t.listName}</span>}
            {t.notes && <span className="min-w-0 truncate">📝 {t.notes}</span>}
          </span>
        )}
      </button>
      {label && (
        <button
          type="button"
          onClick={() => onOpen(t)}
          title="Due"
          className={`mt-px shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${label.chip}`}
        >
          {t.remind !== null && t.remind !== undefined && t.time && <span aria-label="Reminder set">🔔 </span>}
          {label.text}
        </button>
      )}
    </li>
  );
}

/** Above the board: a small summary and how to group the columns. */
function BoardBar({
  tasks,
  isDone,
  dates,
  group,
  onGroup,
}: {
  tasks: TodoTask[];
  isDone: (t: TodoTask) => boolean;
  dates: Dates;
  group: BoardGroup;
  onGroup: (g: BoardGroup) => void;
}) {
  const open = tasks.filter((t) => !isDone(t));
  const late = open.filter((t) => t.due && (t.due < dates.today || (t.due === dates.today && !!t.time && t.time < dates.now))).length;
  const today = open.filter((t) => t.due === dates.today).length;
  const urgent = open.filter((t) => t.priority === "urgent").length;
  const done = tasks.length - open.length;
  const stat = (label: string, n: number, tone: string) => (
    <div className="rounded-xl border border-line bg-surface px-3 py-1.5 text-center shadow-sm">
      <p className={`text-lg font-semibold leading-tight tabular-nums ${tone}`}>{n}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
      {stat("Open", open.length, "")}
      {stat("Late", late, late ? "text-danger" : "")}
      {stat("Today", today, today ? "text-accent" : "")}
      {stat("Urgent", urgent, urgent ? "text-red-600" : "")}
      {stat("Done this week", done, "text-emerald-600 dark:text-emerald-400")}
      <div className="ml-auto flex items-center gap-1 rounded-full border border-line bg-surface p-0.5 text-xs" role="tablist" aria-label="Group by">
        <span className="px-2 text-muted">Group by</span>
        {(
          [
            ["list", "List"],
            ["priority", "Priority"],
            ["due", "Due date"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={group === key}
            onClick={() => onGroup(key)}
            className={`rounded-full px-3 py-1 ${group === key ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Board columns by priority or due date; dropping a task on a priority column sets it. */
function GroupColumns({
  group,
  tasks,
  isDone,
  dates,
  onToggle,
  onOpen,
  onPriority,
}: {
  group: "priority" | "due";
  tasks: TodoTask[];
  isDone: (t: TodoTask) => boolean;
  dates: Dates;
  onToggle: (t: TodoTask) => void;
  onOpen: (t: TodoTask) => void;
  onPriority: (t: TodoTask, p: TaskPriority | null) => void;
}) {
  const open = tasks.filter((t) => !isDone(t));
  const weekEnd = ymd(addDays(karachiToday(), 7));
  const columns: { key: string; title: string; band: string; tasks: TodoTask[]; onDrop?: (t: TodoTask) => void }[] =
    group === "priority"
      ? [
          ...PRIORITIES.map((p) => ({
            key: p.key,
            title: p.label,
            band: p.chip,
            tasks: open.filter((t) => t.priority === p.key),
            onDrop: (t: TodoTask) => t.priority !== p.key && onPriority(t, p.key),
          })),
          {
            key: "none",
            title: "No priority",
            band: "bg-surface-2 text-fg",
            tasks: open.filter((t) => !t.priority),
            onDrop: (t: TodoTask) => t.priority && onPriority(t, null),
          },
        ]
      : [
          { key: "late", title: "Late", band: "bg-red-100 text-red-900 dark:bg-red-950/70 dark:text-red-100", tasks: open.filter((t) => t.due && t.due < dates.today) },
          { key: "today", title: "Today", band: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-100", tasks: open.filter((t) => t.due === dates.today) },
          { key: "tomorrow", title: "Tomorrow", band: "bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-100", tasks: open.filter((t) => t.due === dates.tomorrow) },
          {
            key: "week",
            title: "This week",
            band: "bg-teal-100 text-teal-900 dark:bg-teal-950/70 dark:text-teal-100",
            tasks: open.filter((t) => t.due && t.due > dates.tomorrow && t.due <= weekEnd),
          },
          { key: "later", title: "Later", band: "bg-violet-100 text-violet-900 dark:bg-violet-950/70 dark:text-violet-100", tasks: open.filter((t) => t.due && t.due > weekEnd) },
          { key: "none", title: "No date", band: "bg-surface-2 text-fg", tasks: open.filter((t) => !t.due) },
        ];
  return (
    <>
      {columns.map((c) => (
        <GroupColumn
          key={c.key}
          title={c.title}
          band={c.band}
          tasks={c.tasks}
          onDrop={c.onDrop}
          dates={dates}
          onToggle={onToggle}
          onOpen={onOpen}
          draggable={group === "priority"}
        />
      ))}
    </>
  );
}

function GroupColumn({
  title,
  band,
  tasks,
  onDrop,
  dates,
  onToggle,
  onOpen,
  draggable,
}: {
  title: string;
  band: string;
  tasks: TodoTask[];
  onDrop?: (t: TodoTask) => void;
  dates: Dates;
  onToggle: (t: TodoTask) => void;
  onOpen: (t: TodoTask) => void;
  draggable: boolean;
}) {
  const drop = useDrop(onDrop);
  return (
    <div
      {...drop.props}
      className={`flex max-h-full w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm ${
        drop.over ? "ring-2 ring-accent ring-offset-1" : ""
      }`}
    >
      <div className={`flex items-center gap-2 px-4 py-2 text-lg font-semibold ${band}`}>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {tasks.length > 0 && <span className="rounded-full bg-white/60 px-1.5 text-xs font-medium text-fg dark:bg-black/20">{tasks.length}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pr-2">
        {tasks.length === 0 ? (
          <p className="px-1.5 py-1.5 text-xs text-muted">{onDrop ? "Drop a task here" : "Nothing here"}</p>
        ) : (
          <ul className="space-y-0.5">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} done={false} dates={dates} onToggle={onToggle} onOpen={onOpen} draggable={draggable} showList />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** "+ Add a task" for one list: opens into a box with 🎤 and an optional due date. */
function AddTask({ onAdd }: { onAdd: (title: string, due: string | null, time: string | null, remind: number | null) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");
  const [remind, setRemind] = useState<number | null>(DEFAULT_REMIND);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  // 🎤 fills the task's text, in the language picked for notes.
  const voiceLang = useRef<DictationLang>(savedDictationLang());
  const dictation = useDictation("en-US", (spoken) => {
    const text = voiceLang.current.roman ? toRomanUrdu(spoken) : spoken;
    setTitle((t) => (t.trim() ? `${t.trim()} ${text}` : text).slice(0, 255));
  });
  function toggleVoice() {
    if (dictation.listening) return dictation.stop();
    voiceLang.current = savedDictationLang();
    dictation.start(voiceLang.current.speech);
  }

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (dictation.listening) dictation.stop();
    if (!title.trim()) return;
    setError(null);
    start(async () => {
      const withTime = (due && time) || null;
      if (withTime && remind !== null) askNotifyPermission();
      const err = await onAdd(title, due || null, withTime, withTime ? remind : null);
      if (err) return setError(err);
      setTitle("");
      setDue("");
      setTime("");
      input.current?.focus();
    });
  }

  function cancel() {
    if (dictation.listening) dictation.stop();
    setEditing(false);
    setTitle("");
    setDue("");
    setTime("");
    setError(null);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mb-1 flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-surface-2 dark:text-sky-400"
      >
        <span className="grid size-4 place-items-center text-base leading-none">＋</span>
        Add a task
      </button>
    );
  }

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), cancel())} className="mb-2 space-y-1.5 rounded-lg bg-surface-2/60 p-1.5">
      <div className="relative">
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
          placeholder={dictation.listening ? "Listening…" : "Title"}
          aria-label="New task"
          dir="auto"
          className="w-full rounded-lg border border-line bg-surface py-1.5 pl-2.5 pr-9 text-sm outline-none focus:border-accent"
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={dictation.listening}
            aria-label={dictation.listening ? "Stop dictation" : "Speak the task"}
            title={dictation.listening ? "Stop" : "Speak the task (language as picked in Notes)"}
            className={`absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-sm ${
              dictation.listening ? "animate-pulse bg-red-500 text-white" : "hover:bg-surface-2"
            }`}
          >
            🎤
          </button>
        )}
      </div>
      {(dictation.error || error) && (
        <p className="rounded-lg bg-danger-soft px-2 py-1 text-[11px] leading-snug text-danger" role="alert">
          {error ?? dictation.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            if (e.target.value && !due) setDue(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }));
          }}
          aria-label="Due time"
          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
        />
        {time && <ReminderSelect value={remind} onChange={setRemind} small />}
        <button type="button" onClick={cancel} className="ml-auto rounded-lg px-2 py-1 text-xs text-muted hover:text-fg">
          Cancel
        </button>
        <button disabled={pending || !title.trim()} className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

/** A task opened from the list: edit its title, notes and due date, tick it, or delete it. */
function TaskDetail({
  task,
  onPriority,
  onChecklist,
  lists,
  onMove,
  done,
  openUrl,
  onClose,
  onToggle,
  onSaved,
  onColor,
}: {
  task: TodoTask;
  onPriority: (p: TaskPriority | null) => void;
  onChecklist: () => Promise<void>;
  lists: TodoList[];
  onMove: (toListId: string) => Promise<string | null>;
  done: boolean;
  openUrl: string;
  onClose: () => void;
  onToggle: () => void;
  onSaved: () => Promise<void>;
  onColor: (color: NoteColor | null) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [due, setDue] = useState(task.due ?? "");
  const [time, setTime] = useState(task.time ?? "");
  const [remind, setRemind] = useState<number | null>(task.time ? (task.remind ?? null) : DEFAULT_REMIND);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (due && time && remind !== null) askNotifyPermission();
    start(async () => {
      const res = await updateTodoTask(task.listId, task.id, {
        title,
        notes,
        due: due || null,
        time: (due && time) || null,
        remind: due && time ? remind : null,
      });
      if (!res.ok) return setError(res.error);
      await onSaved();
    });
  }

  function remove() {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setError(null);
    start(async () => {
      const res = await deleteTodoTask(task.listId, task.id);
      if (!res.ok) return setError(res.error);
      await onSaved();
    });
  }

  const field = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-label="Task"
        className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          {lists.length > 1 ? (
            <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              List
              <select
                value={task.listId}
                disabled={pending}
                onChange={(e) => {
                  const to = e.target.value;
                  setError(null);
                  start(async () => {
                    const err = await onMove(to);
                    if (err) setError(err);
                  });
                }}
                aria-label="Move to list"
                title="Move this task to another list"
                className="min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {done && <span>· Completed</span>}
            </label>
          ) : (
            <p className="text-xs text-muted">
              {task.listName}
              {done && " · Completed"}
            </p>
          )}
          <button type="button" onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} dir="auto" aria-label="Title" className={`${field} text-base font-medium`} />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={8000}
          dir="auto"
          placeholder="Details / notes"
          aria-label="Notes"
          className={field}
        />
        <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg" />
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              if (e.target.value && !due) setDue(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }));
            }}
            aria-label="Due time"
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg"
          />
          {due && (
            <button
              type="button"
              onClick={() => {
                setDue("");
                setTime("");
              }}
              className="text-xs hover:text-fg"
            >
              clear
            </button>
          )}
        </label>
        {due && time && (
          <label className="flex items-center gap-2 text-sm text-muted">
            🔔 Reminder
            <ReminderSelect value={remind} onChange={setRemind} />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-muted">
          Priority
          <select
            value={task.priority ?? ""}
            onChange={(e) => onPriority((e.target.value || null) as TaskPriority | null)}
            aria-label="Priority"
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg"
          >
            <option value="">None</option>
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {priorityOf(task.priority) && <span className={`size-2.5 rounded-full ${priorityOf(task.priority)!.dot}`} aria-hidden />}
        </label>
        {lists.length > 0 && <Checklist task={task} onChanged={onChecklist} />}
        <div className="flex items-center gap-1.5" role="group" aria-label="Colour">
          <span className="mr-1 text-sm text-muted">Colour</span>
          <button
            type="button"
            onClick={() => onColor(null)}
            aria-label="No colour"
            aria-pressed={!task.color}
            className={`grid size-6 place-items-center rounded-full border border-line text-[10px] text-muted ${!task.color ? "ring-2 ring-fg ring-offset-1" : ""}`}
          >
            ✕
          </button>
          {TASK_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onColor(c.key)}
              aria-label={c.key}
              aria-pressed={task.color === c.key}
              className={`size-6 rounded-full ${c.dot} ${task.color === c.key ? "ring-2 ring-fg ring-offset-1" : ""}`}
            />
          ))}
        </div>
        {error && (
          <p className="rounded-lg bg-danger-soft px-2 py-1 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={remove} disabled={pending} className="rounded-xl px-3 py-2 text-sm text-danger hover:bg-danger-soft disabled:opacity-60">
            Delete
          </button>
          <a href={openUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:text-fg">
            Open ↗
          </a>
          <button type="button" onClick={onToggle} disabled={pending} className="ml-auto rounded-xl border border-line px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-60">
            {done ? "Mark not done" : "✓ Done"}
          </button>
          <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReminderSelect({ value, onChange, small }: { value: number | null; onChange: (v: number | null) => void; small?: boolean }) {
  return (
    <select
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      aria-label="Reminder"
      className={`rounded-lg border border-line bg-surface px-2 py-1 text-fg ${small ? "text-xs" : "text-sm"}`}
    >
      {REMINDERS.map((r) => (
        <option key={r.label} value={r.value === null ? "" : String(r.value)}>
          {small && r.value !== null ? `🔔 ${r.label}` : r.label}
        </option>
      ))}
    </select>
  );
}

/** A task's checklist (Google subtasks): tick, remove or add items. */
function Checklist({ task, onChanged }: { task: TodoTask; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState(task.subtasks ?? []);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setItems(task.subtasks ?? []), [task.subtasks]);

  function tick(id: string, done: boolean) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, done } : x)));
    start(async () => {
      const res = await setTodoTaskDone(task.listId, id, done);
      if (!res.ok) setError(res.error);
      await onChanged();
    });
  }
  function remove(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id));
    start(async () => {
      const res = await deleteTodoTask(task.listId, id);
      if (!res.ok) setError(res.error);
      await onChanged();
    });
  }
  // Not a <form>: the checklist sits inside the task's own form.
  function add() {
    const title = text.trim();
    if (!title) return;
    setError(null);
    start(async () => {
      const res = await addTodoSubtask(task.listId, task.id, title, items.at(-1)?.id ?? null);
      if (!res.ok) return setError(res.error);
      setText("");
      await onChanged();
    });
  }

  const done = items.filter((x) => x.done).length;
  return (
    <div className="space-y-1.5 rounded-xl border border-line p-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">☑ Checklist</span>
        {items.length > 0 && (
          <span className="text-xs text-muted">
            {done}/{items.length}
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      <ul className="space-y-0.5">
        {items.map((x) => (
          <li key={x.id} className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-2">
            <input
              type="checkbox"
              checked={x.done}
              onChange={() => tick(x.id, !x.done)}
              aria-label={x.done ? `Untick "${x.title}"` : `Tick "${x.title}"`}
              className="size-4 shrink-0 cursor-pointer accent-emerald-600"
            />
            <span className={`min-w-0 flex-1 text-sm ${x.done ? "text-muted line-through" : ""}`} dir="auto">
              {x.title}
            </span>
            <button
              type="button"
              onClick={() => remove(x.id)}
              aria-label={`Remove "${x.title}"`}
              className="text-xs text-muted opacity-0 hover:text-danger group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          maxLength={255}
          placeholder="+ Add an item"
          aria-label="New checklist item"
          dir="auto"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || !text.trim()}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
