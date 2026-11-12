"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { applyTask, taskDetail } from "@/app/sstasks/actions";
import type { SsTaskDetail, SsTaskOp } from "@/lib/sstasks";

type Project = { id: string; name: string; workspace: string };
type Person = { id: string; name: string };

const PRIORITIES = [
  { key: "urgent", label: "Urgent" },
  { key: "important", label: "Important" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const label = "mb-1 block text-xs text-muted";

const when = (iso: string) => {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

/**
 * The task panel inside the dashboard, like Planner's task card / the Task Hub
 * app's drawer: title, project, column, priority, dates, people, notes,
 * checklist, comments and attachments. Moving, assigning and deleting reuse
 * the panel's existing actions so the list updates the same way.
 */
export function TaskPanel({
  taskId,
  projects,
  openHref,
  onClose,
  onChanged,
  onMove,
  onAssign,
  onDelete,
}: {
  taskId: string;
  projects: Project[];
  openHref: string;
  onClose: () => void;
  onChanged: () => void;
  onMove: (projectId: string) => Promise<void> | void;
  onAssign: (person: Person, on: boolean) => Promise<void> | void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<SsTaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await taskDetail(taskId);
    if (res.ok) setD(res.detail);
    else setError(res.error);
  }, [taskId]);

  useEffect(() => {
    setD(null);
    setError(null);
    reload();
  }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function apply(op: SsTaskOp, optimistic?: (x: SsTaskDetail) => SsTaskDetail) {
    if (d && optimistic) setD(optimistic(d));
    setBusy(true);
    setError(null);
    const res = await applyTask(taskId, op);
    setBusy(false);
    if (!res.ok) setError(res.error);
    await reload();
    onChanged();
  }

  const workspaces = [...new Set(projects.map((p) => p.workspace))];

  // Rendered at the end of <body>, so no card, board or full-screen wrapper can clip or cover it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Task details"
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-2xl"
      >
        {!d ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">{error ?? "Loading task…"}</p>
            <button type="button" onClick={onClose} aria-label="Close" className="px-2 text-muted hover:text-fg">
              ✕
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line pb-3">
              <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={d.done} onChange={() => apply({ op: "set", done: !d.done }, (x) => ({ ...x, done: !x.done }))} className="size-4 accent-[var(--accent)]" />
                Mark complete
              </label>
              {d.can_delete && (
                <button type="button" onClick={onDelete} className="text-sm text-danger hover:underline">
                  Delete
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Close" className="px-1 text-lg leading-none text-muted hover:text-fg">
                ✕
              </button>
            </div>

            {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

            <input
              key={`t-${d.title}`}
              defaultValue={d.title}
              maxLength={300}
              dir="auto"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.title && apply({ op: "set", title: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              className={`${field} text-base font-semibold`}
              aria-label="Title"
            />
            {(d.created_by || d.created_at) && (
              <p className="-mt-2 text-xs text-muted">
                Created by <b className="font-medium text-fg">{d.created_by?.name ?? "Someone"}</b>
                {d.created_at && <> · {when(d.created_at)}</>}
              </p>
            )}

            <div>
              <span className={label}>Project (move)</span>
              <select
                value={d.project_id}
                onChange={async (e) => {
                  setBusy(true);
                  await onMove(e.target.value);
                  setBusy(false);
                  await reload();
                }}
                className={field}
              >
                {!projects.some((p) => p.id === d.project_id) && <option value={d.project_id}>This project</option>}
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={label}>Bucket</span>
                <select value={d.bucket_id ?? ""} onChange={(e) => e.target.value && apply({ op: "set", bucket: e.target.value }, (x) => ({ ...x, bucket_id: e.target.value }))} className={field}>
                  {!d.bucket_id && <option value="">—</option>}
                  {d.buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className={label}>Priority</span>
                <select value={d.priority ?? ""} onChange={(e) => apply({ op: "set", priority: e.target.value }, (x) => ({ ...x, priority: e.target.value || null }))} className={field}>
                  <option value="">None</option>
                  {PRIORITIES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className={label}>Start</span>
                <input type="date" value={d.start ?? ""} onChange={(e) => apply({ op: "set", start: e.target.value }, (x) => ({ ...x, start: e.target.value || null }))} className={field} />
              </div>
              <div>
                <span className={label}>Due</span>
                <input type="date" value={d.due ?? ""} onChange={(e) => apply({ op: "set", due: e.target.value }, (x) => ({ ...x, due: e.target.value || null }))} className={field} />
              </div>
              <div className="col-span-2 flex items-end gap-2">
                <div className="flex-1">
                  <span className={label}>Time (optional — shows in the week view's hours)</span>
                  <input
                    type="time"
                    step={900}
                    value={d.time ?? ""}
                    disabled={!d.due}
                    onChange={(e) => apply({ op: "set", time: e.target.value }, (x) => ({ ...x, time: e.target.value || null }))}
                    className={`${field} disabled:opacity-50`}
                  />
                </div>
                {d.time && (
                  <button type="button" onClick={() => apply({ op: "set", time: "" }, (x) => ({ ...x, time: null }))} className="rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2">
                    All day
                  </button>
                )}
              </div>
            </div>

            <div>
              <span className={label}>Assigned to</span>
              <div className="flex flex-wrap gap-1.5">
                {d.people.map((p) => {
                  const on = d.assignee_ids.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setD({ ...d, assignee_ids: on ? d.assignee_ids.filter((x) => x !== p.id) : [...d.assignee_ids, p.id] });
                        await onAssign({ id: p.id, name: p.name }, !on);
                        await reload();
                      }}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent bg-accent/10 font-medium text-accent" : "border-line hover:bg-surface-2"}`}
                      title={p.email}
                    >
                      {p.name}
                      {on ? " ✓" : ""}
                    </button>
                  );
                })}
                {d.people.length === 0 && <span className="text-xs text-muted">Nobody else is in this project yet.</span>}
              </div>
            </div>

            <div>
              <span className={label}>Notes</span>
              <textarea
                key={`n-${d.id}`}
                defaultValue={d.notes}
                rows={4}
                dir="auto"
                placeholder="Details, links, anything useful"
                onBlur={(e) => e.target.value !== d.notes && apply({ op: "set", notes: e.target.value })}
                className={`${field} resize-y`}
              />
            </div>

            <section className="space-y-2 rounded-xl border border-line p-3">
              <p className="text-sm font-medium">
                ☑ Checklist {d.checklist.length > 0 && <span className="text-xs text-muted">({d.checklist.filter((c) => c.done).length}/{d.checklist.length})</span>}
              </p>
              <ul className="space-y-1">
                {d.checklist.map((c) => (
                  <li key={c.id} className="group flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={() => apply({ op: "check_toggle", id: c.id }, (x) => ({ ...x, checklist: x.checklist.map((i) => (i.id === c.id ? { ...i, done: !i.done } : i)) }))}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span className={`min-w-0 flex-1 ${c.done ? "text-muted line-through" : ""}`} dir="auto">
                      {c.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => apply({ op: "check_delete", id: c.id }, (x) => ({ ...x, checklist: x.checklist.filter((i) => i.id !== c.id) }))}
                      aria-label="Remove item"
                      className="text-xs text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!check.trim()) return;
                  const title = check;
                  setCheck("");
                  apply({ op: "check_add", title });
                }}
                className="flex gap-2"
              >
                <input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="+ Add an item" maxLength={300} dir="auto" className={field} />
                <button disabled={!check.trim()} className="rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-50">
                  Add
                </button>
              </form>
            </section>

            {d.attachments && (
              <section className="space-y-2 rounded-xl border border-line p-3">
                <p className="text-sm font-medium">📎 Attachments ({d.attachments.length})</p>
                {d.attachments.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {d.attachments.map((a) => (
                      <li key={a.id} className="truncate">
                        📄 {a.name}
                      </li>
                    ))}
                  </ul>
                )}
                <a href={openHref} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                  Open in Task Hub to view or add files ↗
                </a>
              </section>
            )}

            <section className="space-y-2">
              <p className="text-sm font-medium">💬 Comments</p>
              <ul className="space-y-2">
                {d.comments.map((c) => (
                  <li key={c.id} className={`rounded-lg px-3 py-2 text-sm ${c.mine ? "bg-accent/10" : "bg-surface-2"}`}>
                    <p className="text-xs text-muted">
                      <b className="text-fg">{c.name}</b> · {when(c.created_at)}
                    </p>
                    <p className="whitespace-pre-wrap" dir="auto">
                      {c.body}
                    </p>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  const body = comment;
                  setComment("");
                  apply({ op: "comment", body });
                }}
                className="flex gap-2"
              >
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={4000} dir="auto" className={field} />
                <button disabled={!comment.trim()} className="rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-50">
                  Send
                </button>
              </form>
            </section>

            <a href={openHref} target="_blank" rel="noopener noreferrer" className="mt-auto text-xs text-accent hover:underline">
              Open in Task Hub ↗
            </a>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
