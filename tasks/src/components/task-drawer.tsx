"use client";

import { useCallback, useEffect, useState } from "react";
import { ago } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";
import { PRIORITIES, type Bucket, type ChecklistItem, type Comment, type Priority, type Profile, type Task } from "@/lib/types";
import { Avatar, useAppData } from "./data";

const field = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * A task opened from the board or a list: everything about it, saved as you
 * go (title / notes on leaving the box, the rest at once).
 */
export function TaskDrawer({
  taskId,
  buckets,
  assignable,
  onClose,
  onChanged,
}: {
  taskId: string;
  buckets: Bucket[];
  assignable: Profile[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { me, people } = useAppData();
  const [task, setTask] = useState<Task | null>(null);
  const [checks, setChecks] = useState<ChecklistItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCheck, setNewCheck] = useState("");
  const [newComment, setNewComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [t, c, m] = await Promise.all([
      sb.from("tasks").select("*, task_assignees(user_id)").eq("id", taskId).maybeSingle(),
      sb.from("checklist_items").select("*").eq("task_id", taskId).order("position"),
      sb.from("comments").select("*").eq("task_id", taskId).order("created_at"),
    ]);
    if (!t.data) return setError("This task is gone or you can't see it.");
    setTask(t.data as Task);
    setChecks((c.data ?? []) as ChecklistItem[]);
    setComments((m.data ?? []) as Comment[]);
  }, [taskId]);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  async function save(patch: Partial<Task>) {
    if (!task) return;
    setTask({ ...task, ...patch });
    const { error } = await supabase().from("tasks").update(patch).eq("id", task.id);
    if (error) setError(error.message);
    onChanged();
  }

  async function toggleAssignee(userId: string) {
    if (!task) return;
    const has = task.task_assignees?.some((a) => a.user_id === userId);
    const sb = supabase();
    const { error } = has
      ? await sb.from("task_assignees").delete().eq("task_id", task.id).eq("user_id", userId)
      : await sb.from("task_assignees").insert({ task_id: task.id, user_id: userId });
    if (error) setError(error.message);
    await load();
    onChanged();
  }

  async function addCheck() {
    if (!task || !newCheck.trim()) return;
    const { error } = await supabase()
      .from("checklist_items")
      .insert({ task_id: task.id, title: newCheck.trim(), position: (checks.at(-1)?.position ?? 0) + 1 });
    if (error) return setError(error.message);
    setNewCheck("");
    await load();
    onChanged();
  }
  async function tickCheck(c: ChecklistItem) {
    setChecks((xs) => xs.map((x) => (x.id === c.id ? { ...x, done: !c.done } : x)));
    await supabase().from("checklist_items").update({ done: !c.done }).eq("id", c.id);
    onChanged();
  }
  async function removeCheck(id: string) {
    setChecks((xs) => xs.filter((x) => x.id !== id));
    await supabase().from("checklist_items").delete().eq("id", id);
    onChanged();
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !newComment.trim()) return;
    const { error } = await supabase().from("comments").insert({ task_id: task.id, body: newComment.trim() });
    if (error) return setError(error.message);
    setNewComment("");
    await load();
  }

  async function remove() {
    if (!task || !confirm(`Delete "${task.title}"?`)) return;
    const { error } = await supabase().from("tasks").delete().eq("id", task.id);
    if (error) return setError(error.message);
    onChanged();
    onClose();
  }

  const checked = checks.filter((c) => c.done).length;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Task" className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {task && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={task.done} onChange={() => save({ done: !task.done })} className="size-4 accent-emerald-600" />
              {task.done ? "Completed" : "Mark complete"}
            </label>
          )}
          <div className="flex-1" />
          <button type="button" onClick={remove} className="rounded-lg px-2 py-1 text-sm text-danger hover:bg-danger-soft">
            Delete
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-muted hover:text-fg">
            ✕
          </button>
        </div>
        {!task ? (
          <p className="p-4 text-sm text-muted">{error ?? "Loading…"}</p>
        ) : (
          <div className="space-y-4 p-4">
            <input
              defaultValue={task.title}
              key={`t-${task.id}`}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== task.title && save({ title: e.target.value.trim() })}
              dir="auto"
              aria-label="Title"
              className={`${field} text-base font-semibold`}
            />

            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="space-y-1">
                <span className="text-xs text-muted">Bucket</span>
                <select value={task.bucket_id ?? ""} onChange={(e) => save({ bucket_id: e.target.value || null })} className={field}>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">Priority</span>
                <select value={task.priority ?? ""} onChange={(e) => save({ priority: (e.target.value || null) as Priority | null })} className={field}>
                  <option value="">None</option>
                  {PRIORITIES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">Start</span>
                <input type="date" value={task.start_date ?? ""} onChange={(e) => save({ start_date: e.target.value || null })} className={field} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted">Due</span>
                <input type="date" value={task.due_date ?? ""} onChange={(e) => save({ due_date: e.target.value || null })} className={field} />
              </label>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted">Assigned to</p>
              <div className="flex flex-wrap gap-1.5">
                {assignable.map((p) => {
                  const on = task.task_assignees?.some((a) => a.user_id === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleAssignee(p.id)}
                      className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs ${
                        on ? "border-accent bg-accent/10 font-medium text-accent" : "border-line hover:bg-surface-2"
                      }`}
                    >
                      <Avatar person={p} size="xs" />
                      {p.id === me?.id ? "Me" : p.full_name || p.email}
                      {on && " ✓"}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-muted">Notes</span>
              <textarea
                defaultValue={task.notes}
                key={`n-${task.id}`}
                rows={4}
                dir="auto"
                onBlur={(e) => e.target.value !== task.notes && save({ notes: e.target.value })}
                placeholder="Details, links, anything useful"
                className={field}
              />
            </label>

            <div className="space-y-1.5 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">☑ Checklist</span>
                {checks.length > 0 && (
                  <span className="text-xs text-muted">
                    {checked}/{checks.length}
                  </span>
                )}
              </div>
              {checks.length > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(checked / checks.length) * 100}%` }} />
                </div>
              )}
              <ul className="space-y-0.5">
                {checks.map((c) => (
                  <li key={c.id} className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-2">
                    <input type="checkbox" checked={c.done} onChange={() => tickCheck(c)} className="size-4 accent-emerald-600" />
                    <span className={`min-w-0 flex-1 text-sm ${c.done ? "text-muted line-through" : ""}`} dir="auto">
                      {c.title}
                    </span>
                    <button type="button" onClick={() => removeCheck(c.id)} aria-label="Remove" className="text-xs text-muted opacity-0 hover:text-danger group-hover:opacity-100">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-1.5">
                <input
                  value={newCheck}
                  onChange={(e) => setNewCheck(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCheck())}
                  placeholder="+ Add an item"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                />
                <button type="button" onClick={addCheck} disabled={!newCheck.trim()} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60">
                  Add
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">💬 Comments</p>
              <ul className="space-y-2">
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <Avatar person={people.get(c.user_id)} />
                    <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2">
                      <p className="text-xs">
                        <b>{people.get(c.user_id)?.full_name ?? "Someone"}</b> <span className="text-muted">· {ago(c.created_at)}</span>
                      </p>
                      <p className="whitespace-pre-wrap text-sm" dir="auto">
                        {c.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <form onSubmit={addComment} className="flex gap-2">
                <input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Write a comment…" dir="auto" className={field} />
                <button disabled={!newComment.trim()} className="rounded-xl bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">
                  Send
                </button>
              </form>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
