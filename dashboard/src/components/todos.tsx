"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addTodoTask, createTodoList, deleteTodoTask, setTodoTaskColor, setTodoTaskDone, updateTodoTask } from "@/app/todo/actions";
import { toRomanUrdu } from "@/lib/roman-urdu";
import { karachiToday, addDays } from "@/lib/time";
import type { NoteColor, TodoList, TodoTask } from "@/lib/types";
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

  async function add(listId: string, title: string, due: string | null, time: string | null): Promise<string | null> {
    const res = await addTodoTask(listId, title, due, time);
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
      const res = await setTodoTaskDone(task.listId, task.id, next);
      if (!res.ok) {
        setError(res.error);
        setDoneLocal(task.id, undefined);
      }
    });
  }

  const dates: Dates = { today: ymd(karachiToday()), tomorrow: ymd(addDays(karachiToday(), 1)), now: nowHm() };
  const ready = state.status === "ready" ? state : null;
  const sections = (layout: "stack" | "board") =>
    ready!.lists.map((list) => (
      <ListSection
        key={list.id}
        layout={layout}
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
    <div className="flex items-center gap-2 text-xs">
      {ready?.provider === "google" && (
        <button type="button" onClick={newList} disabled={pending} className="text-muted hover:text-fg">
          + List
        </button>
      )}
      <button type="button" onClick={load} className="text-muted hover:text-fg" aria-label="Refresh tasks">
        ↻
      </button>
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
}: {
  layout: "stack" | "board";
  list: TodoList;
  tasks: TodoTask[];
  isDone: (t: TodoTask) => boolean;
  dates: Dates;
  onToggle: (t: TodoTask) => void;
  onOpen: (t: TodoTask) => void;
  onAdd: (listId: string, title: string, due: string | null, time: string | null) => Promise<string | null>;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [folded, setFolded] = useState(false);
  const open = tasks.filter((t) => !isDone(t));
  const finished = tasks.filter((t) => isDone(t));
  const board = layout === "board";

  return (
    <div className={board ? "flex max-h-full w-80 shrink-0 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm" : "rounded-xl border border-line/70 p-2.5"}>
      <button
        type="button"
        onClick={() => !board && setFolded((f) => !f)}
        aria-expanded={board ? undefined : !folded}
        className={`flex w-full items-center gap-2 text-left ${board ? "mb-2 cursor-default text-lg" : "text-sm"} font-semibold`}
      >
        {!board && <span className="w-3 text-xs text-muted">{folded ? "▸" : "▾"}</span>}
        <span className="min-w-0 flex-1 truncate">{list.name}</span>
        <span className="text-xs font-normal text-muted">{open.length || ""}</span>
      </button>
      {!folded && (
        <div className={board ? "min-h-0 flex-1 overflow-y-auto pr-1" : "mt-1.5"}>
          <AddTask onAdd={(title, due, time) => onAdd(list.id, title, due, time)} />
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
          {label.text}
        </button>
      )}
    </li>
  );
}

/** "+ Add a task" for one list: opens into a box with 🎤 and an optional due date. */
function AddTask({ onAdd }: { onAdd: (title: string, due: string | null, time: string | null) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");
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
      const err = await onAdd(title, due || null, (due && time) || null);
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
    start(async () => {
      const res = await updateTodoTask(task.listId, task.id, { title, notes, due: due || null, time: (due && time) || null });
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
