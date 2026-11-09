"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { addTodoTask, setTodoTaskDone } from "@/app/todo/actions";
import { karachiToday, addDays } from "@/lib/time";
import type { TodoList, TodoTask } from "@/lib/types";

const REFRESH_MS = 5 * 60 * 1000;
const TODO_URL = "https://to-do.live.com/tasks/";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "disconnected" }
  | { status: "ready"; lists: TodoList[]; tasks: TodoTask[] };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = ({ y, m, d }: { y: number; m: number; d: number }) => `${y}-${pad(m)}-${pad(d)}`;
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

function dueLabel(due: string, today: string, tomorrow: string) {
  if (due < today) return { text: `Overdue · ${dueFmt.format(new Date(`${due}T00:00:00Z`))}`, tone: "text-danger" };
  if (due === today) return { text: "Today", tone: "text-accent" };
  if (due === tomorrow) return { text: "Tomorrow", tone: "text-muted" };
  return { text: dueFmt.format(new Date(`${due}T00:00:00Z`)), tone: "text-muted" };
}

/** Open tasks from Microsoft To Do: add one, tick one off. */
export function Todos() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [listId, setListId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/todo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (!body.connected) return setState({ status: "disconnected" });
      setState({ status: "ready", lists: body.lists, tasks: body.tasks });
      setDone(new Set());
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

  function add(e: React.FormEvent) {
    e.preventDefault();
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

  function toggle(task: TodoTask) {
    const next = !done.has(task.id);
    setDone((s) => {
      const copy = new Set(s);
      if (next) copy.add(task.id);
      else copy.delete(task.id);
      return copy;
    });
    start(async () => {
      const res = await setTodoTaskDone(task.listId, task.id, next);
      if (!res.ok) {
        setError(res.error);
        setDone((s) => {
          const copy = new Set(s);
          if (next) copy.delete(task.id);
          else copy.add(task.id);
          return copy;
        });
      }
    });
  }

  const today = ymd(karachiToday());
  const tomorrow = ymd(addDays(karachiToday(), 1));

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="grid size-6 place-items-center rounded-md bg-[#2564cf] text-xs text-white">✓</span>
          To Do
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={load} className="text-muted hover:text-fg" aria-label="Refresh tasks">
            ↻
          </button>
          <a href={TODO_URL} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-fg">
            Open ↗
          </a>
        </div>
      </div>

      {state.status === "disconnected" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">Connect Microsoft To Do once to see and add your tasks here.</p>
          <a href="/api/microsoft/connect" className="inline-block rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            Connect Microsoft To Do
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
            <input
              ref={input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              placeholder="+ Add a task"
              aria-label="New task"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {title.trim() && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  aria-label="Due date"
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                />
                {state.lists.length > 1 && (
                  <select
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    aria-label="List"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                  >
                    {state.lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
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

          {state.tasks.length === 0 ? (
            <p className="py-2 text-sm text-muted">All done — no open tasks.</p>
          ) : (
            <ul className="max-h-80 space-y-0.5 overflow-y-auto pr-1">
              {state.tasks.map((t) => {
                const isDone = done.has(t.id);
                const label = t.due ? dueLabel(t.due, today, tomorrow) : null;
                return (
                  <li key={`${t.listId}:${t.id}`}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-surface-2">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(t)} className="mt-0.5 size-4 shrink-0 accent-[#2564cf]" />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${isDone ? "text-muted line-through" : ""}`}>
                          {t.important && <span className="mr-1 text-amber-500" aria-label="Important">★</span>}
                          {t.title}
                        </span>
                        {(label || state.lists.length > 1) && (
                          <span className="block truncate text-[11px] text-muted">
                            {label && <span className={label.tone}>{label.text}</span>}
                            {label && state.lists.length > 1 && " · "}
                            {state.lists.length > 1 && t.listName}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
