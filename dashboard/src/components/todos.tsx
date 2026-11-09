"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addTodoTask, createTodoList, deleteTodoTask, importTodoTasks, setTodoListColor, setTodoTaskColor, setTodoTaskDone, updateTodoTask } from "@/app/todo/actions";
import { toRomanUrdu } from "@/lib/roman-urdu";
import { IMPORT_MAX_TASKS, importCount, parseTaskImport } from "@/lib/task-import";
import { karachiToday, addDays } from "@/lib/time";
import type { ListColor, NoteColor, TodoList, TodoTask } from "@/lib/types";
import { savedDictationLang, useDictation, type DictationLang } from "./dictation";
import { onDashboardRefresh } from "@/lib/refresh-event";

const REFRESH_MS = 5 * 60 * 1000;
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
  const [importing, setImporting] = useState(false);
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
      {ready?.provider === "google" && (
        <button type="button" onClick={() => setImporting(true)} className="text-muted hover:text-fg" title="Paste many tasks at once">
          ⇪ Import
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
              {error && <div className="px-4 pt-3">{errorLine}</div>}
              <div className="flex flex-1 items-start gap-4 overflow-x-auto p-4">{sections("board")}</div>
            </div>
          )}

          {importing && (
            <ImportDialog
              lists={state.lists.map((l) => l.name)}
              onClose={() => setImporting(false)}
              onDone={load}
            />
          )}

          {detail && (
            <TaskDetail
              task={detail}
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
}: {
  color: (typeof LIST_COLORS)[number];
  onColor: (c: ListColor | null) => void;
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
  const [folded, setFolded] = useState(false);
  const [picking, setPicking] = useState(false);
  const open = tasks.filter((t) => !isDone(t));
  const finished = tasks.filter((t) => isDone(t));
  const board = layout === "board";

  return (
    <div
      className={
        board
          ? "flex max-h-full w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
          : "overflow-hidden rounded-xl border border-line/70"
      }
    >
      <div className={`flex items-center gap-1 ${color.band} ${board ? "px-4 py-2" : "px-2.5 py-1"}`}>
        <button
          type="button"
          onClick={() => !board && setFolded((f) => !f)}
          aria-expanded={board ? undefined : !folded}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left font-semibold ${board ? "cursor-default text-lg" : "text-sm"}`}
        >
          {!board && <span className="w-3 text-xs opacity-60">{folded ? "▸" : "▾"}</span>}
          <span className="min-w-0 flex-1 truncate">{list.name}</span>
          {open.length > 0 && <span className="rounded-full bg-white/60 px-1.5 text-xs font-medium dark:bg-black/20">{open.length}</span>}
        </button>
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          aria-label={`Colour for ${list.name}`}
          aria-expanded={picking}
          title="Heading colour"
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
                <TaskRow key={t.id} task={t} done={false} dates={dates} onToggle={onToggle} onOpen={onOpen} />
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
}: {
  task: TodoTask;
  done: boolean;
  dates: Dates;
  onToggle: (t: TodoTask) => void;
  onOpen: (t: TodoTask) => void;
}) {
  const label = t.due && !done ? dueLabel(t.due, t.time, dates, dates.now) : null;
  return (
    <li
      className={`flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 ${rowColor(t.color) ?? "hover:bg-surface-2"} ${t.color ? "mb-0.5 hover:brightness-95" : ""}`}
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
        {t.notes && <span className="block truncate text-[11px] text-muted">📝 {t.notes}</span>}
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
  done,
  openUrl,
  onClose,
  onToggle,
  onSaved,
  onColor,
}: {
  task: TodoTask;
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
          <p className="text-xs text-muted">
            {task.listName}
            {done && " · Completed"}
          </p>
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

/** Paste many tasks at once: "# List" lines name the list (made when missing), every other line is a task. */
function ImportDialog({ lists, onClose, onDone }: { lists: string[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const groups = parseTaskImport(text);
  const count = importCount(groups);
  const known = new Set(lists.map((l) => l.trim().toLowerCase()));
  const newLists = groups.filter((g) => g.list && !known.has(g.list.trim().toLowerCase())).map((g) => g.list!);

  function run() {
    setError(null);
    start(async () => {
      const res = await importTodoTasks(text);
      if (!res.ok) return setError(res.error);
      const made = res.data?.createdLists ?? [];
      setResult(`${res.data?.added ?? 0} tasks added${made.length ? ` · new lists: ${made.join(", ")}` : ""}.`);
      setText("");
      await onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Import tasks" className="w-full max-w-lg space-y-3 rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">⇪ Import tasks</h3>
          <button type="button" onClick={onClose} disabled={pending} className="text-muted hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-xs text-muted">
          One task per line. A line starting with <b>#</b> is a list name — made in Google Tasks if it isn’t there yet. Bullets and check
          boxes are dropped.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          rows={12}
          dir="auto"
          autoFocus
          placeholder={"# ERP\nSupplier payments check\nStock report bhejna\n# DUBAI\nRent voucher upload"}
          aria-label="Tasks to import"
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        {count > 0 && (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
            <p className="font-medium">
              {count} task{count === 1 ? "" : "s"} →{" "}
              {groups
                .filter((g) => g.titles.length)
                .map((g) => `${g.list ?? lists[0] ?? "default list"} (${g.titles.length})`)
                .join(", ")}
            </p>
            {newLists.length > 0 && <p className="mt-0.5 text-muted">New lists to make: {newLists.join(", ")}</p>}
            {count > IMPORT_MAX_TASKS && <p className="mt-0.5 text-danger">Up to {IMPORT_MAX_TASKS} at a time.</p>}
          </div>
        )}
        {error && (
          <p className="rounded-lg bg-danger-soft px-2 py-1 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" role="status">
            ✓ {result}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-xl px-3 py-2 text-sm text-muted hover:text-fg">
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={pending || count === 0 || count > IMPORT_MAX_TASKS}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {pending ? `Adding ${count}…` : `Import ${count || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
