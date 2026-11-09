"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addTodoTask, createTodoList, deleteTodoTask, setTodoTaskColor, setTodoTaskDone, updateTodoTask } from "@/app/todo/actions";
import { toRomanUrdu } from "@/lib/roman-urdu";
import { karachiToday, addDays } from "@/lib/time";
import type { NoteColor, TodoList, TodoTask } from "@/lib/types";
import { savedDictationLang, useDictation, type DictationLang } from "./dictation";

const REFRESH_MS = 5 * 60 * 1000;
const OPEN_URL = { google: "https://tasks.google.com/", microsoft: "https://to-do.live.com/tasks/" } as const;
const NEW_LIST = "__new__";

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
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

function dueLabel(due: string, today: string, tomorrow: string) {
  if (due < today) return { text: `Overdue · ${dueFmt.format(new Date(`${due}T00:00:00Z`))}`, tone: "text-danger" };
  if (due === today) return { text: "Today", tone: "text-accent" };
  if (due === tomorrow) return { text: "Tomorrow", tone: "text-muted" };
  return { text: dueFmt.format(new Date(`${due}T00:00:00Z`)), tone: "text-muted" };
}

/** Open tasks from Google Tasks (or Microsoft To Do): add one, tick one off, make a list. */
export function Todos() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [listId, setListId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Ticks not yet confirmed by a reload: task id → done.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [detail, setDetail] = useState<TodoTask | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  // 🎤 fills the new task's text, in the language picked for notes.
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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/todo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.connected) return setState({ status: "disconnected", reconnect: Boolean(body.googleNeedsReconnect) });
      setState({ status: "ready", provider: body.provider, lists: body.lists, tasks: body.tasks });
      setOverrides(new Map());
      setListId((current) => current || body.lists.find((l: TodoList) => l.isDefault)?.id || body.lists[0]?.id || "");
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load" });
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Picking "+ New list…" asks for a name and makes the list in Google Tasks.
  function chooseList(value: string) {
    if (value !== NEW_LIST) return setListId(value);
    const name = window.prompt("New list name");
    if (!name?.trim()) return;
    setError(null);
    start(async () => {
      const res = await createTodoList(name);
      if (!res.ok) return setError(res.error);
      await load();
      if (res.data) setListId(res.data.id);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (dictation.listening) dictation.stop();
    if (!title.trim()) return;
    setError(null);
    start(async () => {
      const res = await addTodoTask(listId, title, due || null);
      if (!res.ok) return setError(res.error);
      setTitle("");
      setDue("");
      await load();
      input.current?.focus();
    });
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

  // Ticking moves the task to "Completed" (and back); only the checkbox does this.
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

  const today = ymd(karachiToday());
  const tomorrow = ymd(addDays(karachiToday(), 1));

  return (
    <section className="h-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="grid size-6 place-items-center rounded-md bg-[#1a73e8] text-xs text-white">✓</span>
          Tasks
        </h2>
        <div className="flex items-center gap-2 text-xs">
          {state.status === "ready" && state.provider === "google" && (
            <button type="button" onClick={() => chooseList(NEW_LIST)} disabled={pending} className="text-muted hover:text-fg">
              + List
            </button>
          )}
          <button type="button" onClick={load} className="text-muted hover:text-fg" aria-label="Refresh tasks">
            ↻
          </button>
          <a
            href={OPEN_URL[state.status === "ready" ? state.provider : "google"]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-fg"
          >
            Open ↗
          </a>
        </div>
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
          <form onSubmit={add} className="mb-3 space-y-2">
            <div className="relative">
              <input
                ref={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={255}
                placeholder={dictation.listening ? "Listening…" : "+ Add a task"}
                aria-label="New task"
                dir="auto"
                className="w-full rounded-xl border border-line bg-surface py-2 pl-3 pr-10 text-sm outline-none focus:border-accent"
              />
              {dictation.supported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  aria-pressed={dictation.listening}
                  aria-label={dictation.listening ? "Stop dictation" : "Speak the task"}
                  title={dictation.listening ? "Stop" : "Speak the task (language as picked in Notes)"}
                  className={`absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-sm ${
                    dictation.listening ? "animate-pulse bg-red-500 text-white" : "hover:bg-surface-2"
                  }`}
                >
                  🎤
                </button>
              )}
            </div>
            {dictation.error && (
              <p className="rounded-lg bg-danger-soft px-2 py-1 text-[11px] leading-snug text-danger" role="alert">
                {dictation.error}
              </p>
            )}
            {title.trim() && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  aria-label="Due date"
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                />
                {(state.lists.length > 1 || state.provider === "google") && (
                  <select
                    value={listId}
                    onChange={(e) => chooseList(e.target.value)}
                    aria-label="List"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                  >
                    {state.lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                    {state.provider === "google" && <option value={NEW_LIST}>+ New list…</option>}
                  </select>
                )}
                <button disabled={pending} className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">
                  Add
                </button>
              </div>
            )}
          </form>

          {error && (
            <p className="mb-2 rounded-lg bg-danger-soft px-2 py-1 text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          {(() => {
            const open = state.tasks.filter((t) => !isDone(t));
            const finished = state.tasks.filter((t) => isDone(t));
            const row = (t: TodoTask) => {
              const doneNow = isDone(t);
              const label = t.due && !doneNow ? dueLabel(t.due, today, tomorrow) : null;
              return (
                <li
                  key={`${t.listId}:${t.id}`}
                  className={`flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 ${rowColor(t.color) ?? "hover:bg-surface-2"} ${
                    t.color ? "mb-0.5 hover:brightness-95" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={doneNow}
                    onChange={() => toggle(t)}
                    aria-label={doneNow ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#1a73e8]"
                  />
                  <button type="button" onClick={() => setDetail(t)} className="min-w-0 flex-1 text-left" dir="auto">
                    <span className={`block text-sm ${doneNow ? "text-muted line-through" : ""}`}>
                      {t.important && <span className="mr-1 text-amber-500" aria-label="Important">★</span>}
                      {t.title}
                    </span>
                    {(label || t.notes || state.lists.length > 1) && (
                      <span className="block truncate text-[11px] text-muted">
                        {[label && <span key="d" className={label.tone}>{label.text}</span>, state.lists.length > 1 && t.listName, t.notes && "📝"]
                          .filter(Boolean)
                          .map((part, k) => (
                            <span key={k}>
                              {k > 0 && " · "}
                              {part}
                            </span>
                          ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            };
            return (
              <div className="max-h-64 overflow-y-auto pr-1">
                {open.length === 0 ? (
                  <p className="py-2 text-sm text-muted">All done — no open tasks.</p>
                ) : (
                  <ul className="space-y-0.5">{open.map(row)}</ul>
                )}
                {finished.length > 0 && (
                  <div className="mt-2 border-t border-line pt-1.5">
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      aria-expanded={showCompleted}
                      className="px-1.5 py-1 text-xs font-medium text-muted hover:text-fg"
                    >
                      {showCompleted ? "▾" : "▸"} Completed ({finished.length})
                    </button>
                    {showCompleted && <ul className="space-y-0.5">{finished.map(row)}</ul>}
                  </div>
                )}
              </div>
            );
          })()}
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
      const res = await updateTodoTask(task.listId, task.id, { title, notes, due: due || null });
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
        <label className="flex items-center gap-2 text-sm text-muted">
          Due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg" />
          {due && (
            <button type="button" onClick={() => setDue("")} className="text-xs hover:text-fg">
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
