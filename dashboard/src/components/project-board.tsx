"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addSsTask, applyTask, assignTask, editColumn, editSsTask, moveColumnTo, placeTask, projectBoard, removeTask } from "@/app/sstasks/actions";
import { TaskPanel } from "@/components/task-panel";
import { karachiToday } from "@/lib/time";
import type { SsBoardTask, SsProjectBoard } from "@/lib/sstasks";

type Project = { id: string; name: string; workspace: string };

const GRAY = "#94a3b8";
// One colour per column, in order (repeats after the last).
const COLUMN_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#e11d48"];
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const PRI: Record<string, { label: string; chip: string }> = {
  urgent: { label: "Urgent", chip: "bg-red-600 text-white" },
  important: { label: "Important", chip: "bg-orange-500 text-white" },
  low: { label: "Low", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
};

function initialsOf(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * A whole project as a Planner board, over the dashboard: its columns, every
 * task in them (done ones folded under each column), add a task to any column,
 * drag between columns, tick done, and open a task's panel.
 */
export function ProjectBoard({
  projectId,
  projects,
  appUrl,
  onClose,
  onChanged,
  onMembers,
}: {
  projectId: string;
  projects: Project[];
  appUrl: string;
  onClose: () => void;
  onChanged: () => void;
  onMembers: () => void;
}) {
  const [board, setBoard] = useState<SsProjectBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Where a dragged task would land: before the open task at `index` in that column.
  const [dropAt, setDropAt] = useState<{ bucket: string; index: number } | null>(null);
  // A column being dragged, and the column it would go before.
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [colOver, setColOver] = useState<string | null>(null);
  const [showDone, setShowDone] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [colMenu, setColMenu] = useState<string | null>(null);
  const k = karachiToday();
  const today = `${k.y}-${String(k.m).padStart(2, "0")}-${String(k.d).padStart(2, "0")}`;

  const load = useCallback(async () => {
    const res = await projectBoard(projectId);
    if (res.ok) {
      setBoard(res.data);
      setError(null);
    } else setError(res.error);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !openTask && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, openTask]);

  const changed = async () => {
    await load();
    onChanged();
  };

  function patchLocal(id: string, patch: Partial<SsBoardTask>) {
    setBoard((b) => (b ? { ...b, tasks: b.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : b));
  }

  async function run(p: Promise<{ ok: true } | { ok: false; error: string }>) {
    const res = await p;
    if (!res.ok) setError(res.error);
    await changed();
  }

  async function add(bucketId: string, first: boolean) {
    const title = (drafts[bucketId] ?? "").trim();
    if (!title) return;
    setDrafts((d) => ({ ...d, [bucketId]: "" }));
    const res = await addSsTask(projectId, title, null, null);
    if (!res.ok) return setError(res.error);
    if (!first) await applyTask(res.id, { op: "set", bucket: bucketId });
    await changed();
  }

  async function column(action: "add" | "rename" | "left" | "right" | "delete", bucketId: string | null, current?: string) {
    setColMenu(null);
    let name: string | null = null;
    if (action === "add" || action === "rename") {
      name = prompt(action === "add" ? "New column name" : "Column name", current ?? "");
      if (!name?.trim()) return;
    }
    if (action === "delete" && !confirm(`Delete the column "${current}"? (Only an empty column can be deleted.)`)) return;
    const res = await editColumn(projectId, action, bucketId, name);
    if (!res.ok) return setError(res.error);
    await changed();
  }

  /** Drops the dragged task into a column before the open task at `index` (or last). */
  function dropTask(bucketId: string, index: number | undefined) {
    const id = dragId;
    setDragId(null);
    setOver(null);
    setDropAt(null);
    if (!id || !board) return;
    const t = board.tasks.find((x) => x.id === id);
    if (!t) return;
    const list = board.tasks.filter((x) => colOfId(x) === bucketId && !x.done && x.id !== id);
    const at = Math.max(0, Math.min(index ?? list.length, list.length));
    const before = list[at]?.id ?? null;
    if (colOfId(t) === bucketId) {
      const cur = board.tasks.filter((x) => colOfId(x) === bucketId && !x.done);
      const i = cur.findIndex((x) => x.id === id);
      if ((cur[i + 1]?.id ?? null) === before) return; // dropped where it already is
    }
    // Show the new order at once; the board reloads after the save.
    setBoard((b) => {
      if (!b) return b;
      const rest = b.tasks.filter((x) => x.id !== id);
      const moved = { ...t, bucket_id: bucketId, done: (b.buckets.find((c) => c.id === bucketId)?.name ?? "").toLowerCase() === "done" ? true : t.done };
      const pos = before ? rest.findIndex((x) => x.id === before) : -1;
      if (pos < 0) {
        const lastInCol = rest.map((x, i) => (colOfId(x) === bucketId && !x.done ? i : -1)).filter((i) => i >= 0).pop();
        rest.splice(lastInCol === undefined ? rest.length : lastInCol + 1, 0, moved);
      } else rest.splice(pos, 0, moved);
      return { ...b, tasks: rest };
    });
    run(placeTask(id, bucketId, before));
  }

  /** Puts the dragged column before `before` (or last). */
  async function dropColumn(before: string | null) {
    const id = dragCol;
    setDragCol(null);
    setColOver(null);
    if (!id || id === before || !board) return;
    setBoard((b) => {
      if (!b) return b;
      const moved = b.buckets.find((x) => x.id === id)!;
      const rest = b.buckets.filter((x) => x.id !== id);
      const at = before ? rest.findIndex((x) => x.id === before) : rest.length;
      rest.splice(at < 0 ? rest.length : at, 0, moved);
      return { ...b, buckets: rest };
    });
    await run(moveColumnTo(projectId, id, before));
  }

  const colOfId = (t: SsBoardTask) =>
    t.bucket_id && (board?.buckets ?? []).some((b) => b.id === t.bucket_id) ? t.bucket_id : board?.buckets[0]?.id;

  if (typeof document === "undefined") return null;
  const color = board?.project.color || GRAY;
  const buckets = board?.buckets ?? [];
  const firstId = buckets[0]?.id;
  const colOf = (t: SsBoardTask) => (t.bucket_id && buckets.some((b) => b.id === t.bucket_id) ? t.bucket_id : firstId);

  const card = (t: SsBoardTask, colColor = GRAY) => {
    const late = !t.done && !!t.due && t.due < today;
    const pri = t.priority ? PRI[t.priority] : undefined;
    return (
      <div
        key={t.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", t.id);
          setDragId(t.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOver(null);
          setDropAt(null);
        }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, input")) setOpenTask(t.id);
        }}
        style={{ borderLeft: `4px solid ${t.done ? GRAY : colColor}` }}
        className={`group flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface p-2.5 shadow-sm transition hover:-translate-y-px hover:shadow-md ${dragId === t.id ? "opacity-40" : ""}`}
      >
        <button
          type="button"
          onClick={() => {
            patchLocal(t.id, { done: !t.done });
            run(applyTask(t.id, { op: "set", done: !t.done }));
          }}
          aria-label={t.done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] transition ${
            t.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-line text-transparent hover:border-emerald-500 hover:text-emerald-600"
          }`}
        >
          ✓
        </button>
        <span className="min-w-0 flex-1">
          <span className={`line-clamp-3 text-sm font-medium ${t.done ? "text-muted line-through" : ""}`}>{t.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            {t.due && (
              <span className={`rounded-full px-1.5 py-0.5 ${late ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-surface-2"}`}>
                {late ? "⚠ " : "📅 "}
                {t.due === today ? "Today" : dueFmt.format(new Date(`${t.due}T00:00:00Z`))}
                {t.time ? ` · ${t.time}` : ""}
              </span>
            )}
            {pri && <span className={`rounded-full px-1.5 py-0.5 ${pri.chip}`}>{pri.label}</span>}
            {t.checks > 0 && <span className={t.checked === t.checks ? "text-up" : ""}>☑ {t.checked}/{t.checks}</span>}
            {t.assignees.length > 0 && (
              <span className="ml-auto flex -space-x-1" title={`Assigned to ${t.assignees.join(", ")}`}>
                {t.assignees.slice(0, 4).map((n) => (
                  <span key={n} className="grid size-[22px] place-items-center rounded-full border-2 border-surface bg-accent/15 text-[9px] font-semibold text-accent">
                    {initialsOf(n)}
                  </span>
                ))}
              </span>
            )}
          </span>
        </span>
      </div>
    );
  };

  return createPortal(
    <div role="dialog" aria-label={`${board?.project.name ?? "Project"} board`} className="fixed inset-0 z-[70] flex flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3" style={{ borderTop: `4px solid ${color}` }}>
        <span className="size-3.5 rounded" style={{ background: color }} aria-hidden />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{board?.project.name ?? "Loading…"}</h2>
          {board && (
            <p className="text-xs text-muted">
              {board.project.workspace} · {board.tasks.filter((t) => !t.done).length} open · {board.tasks.filter((t) => t.done).length} done
            </p>
          )}
        </div>
        <div className="flex-1" />
        <button type="button" onClick={onMembers} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
          👥 Members
        </button>
        <button type="button" onClick={() => load()} title="Refresh" className="rounded-full border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2">
          ↻
        </button>
        <button type="button" onClick={onClose} className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium hover:bg-surface">
          ✕ Close
        </button>
      </header>

      {error && <p className="mx-4 mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!board && !error && <p className="p-6 text-sm text-muted">Loading board…</p>}

      {board && (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4 [scrollbar-width:thin]">
          {buckets.map((b, bi) => {
            const cc = COLUMN_COLORS[bi % COLUMN_COLORS.length];
            const all = board.tasks.filter((t) => colOf(t) === b.id);
            const open = all.filter((t) => !t.done);
            const done = all.filter((t) => t.done);
            return (
              <section
                key={b.id}
                onDragOver={(e) => {
                  if (dragCol) {
                    e.preventDefault();
                    setColOver(b.id);
                    return;
                  }
                  if (!dragId) return;
                  e.preventDefault();
                  setOver(b.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setOver((o) => (o === b.id ? null : o));
                  setDropAt((d) => (d?.bucket === b.id ? null : d));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragCol) return void dropColumn(b.id);
                  dropTask(b.id, dropAt?.bucket === b.id ? dropAt.index : undefined);
                }}
                style={{ backgroundColor: tint(cc, 7), borderTop: `4px solid ${cc}` }}
                className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-xl ${over === b.id ? "ring-2 ring-accent" : ""} ${
                  colOver === b.id && dragCol !== b.id ? "outline outline-4 -outline-offset-2 outline-accent/60" : ""
                } ${dragCol === b.id ? "opacity-40" : ""}`}
              >
                <div
                  className={`relative flex items-center gap-2 px-3 pb-2 pt-2.5 ${board.can_manage ? "cursor-grab active:cursor-grabbing" : ""}`}
                  style={{ backgroundColor: tint(cc, 16) }}
                  draggable={board.can_manage}
                  title={board.can_manage ? "Drag to move the column" : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", b.name);
                    setColMenu(null);
                    setDragCol(b.id);
                  }}
                  onDragEnd={() => {
                    setDragCol(null);
                    setColOver(null);
                  }}
                >
                  {board.can_manage && <span aria-hidden className="text-xs" style={{ color: cc }}>⠿</span>}
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold" title={b.name} style={{ color: cc }}>
                    {b.name}
                  </h3>
                  <span className="rounded-full px-2 text-xs font-semibold text-white" style={{ backgroundColor: cc }}>{open.length}</span>
                  {board.can_manage && (
                    <button
                      type="button"
                      onClick={() => setColMenu((m) => (m === b.id ? null : b.id))}
                      aria-label={`Column options: ${b.name}`}
                      className="rounded px-1 text-sm font-bold leading-none text-muted hover:bg-surface hover:text-fg"
                    >
                      ⋯
                    </button>
                  )}
                  {colMenu === b.id && (
                    <div className="absolute right-2 top-9 z-10 w-44 overflow-hidden rounded-lg border border-line bg-surface text-sm shadow-xl">
                      <button type="button" onClick={() => column("rename", b.id, b.name)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                        ✏️ Rename
                      </button>
                      <button type="button" onClick={() => column("left", b.id)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                        ← Move left
                      </button>
                      <button type="button" onClick={() => column("right", b.id)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                        → Move right
                      </button>
                      <button type="button" onClick={() => column("delete", b.id, b.name)} className="block w-full px-3 py-1.5 text-left text-danger hover:bg-danger-soft">
                        🗑 Delete column
                      </button>
                    </div>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    add(b.id, b.id === firstId);
                  }}
                  className="flex gap-1.5 px-2 py-1.5"
                >
                  <input
                    value={drafts[b.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [b.id]: e.target.value }))}
                    placeholder="+ Add task — type and press Enter"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
                  />
                </form>
                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
                  {open.map((t, i) => (
                    <div
                      key={t.id}
                      onDragOver={(e) => {
                        if (!dragId || dragCol) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        const index = e.clientY < r.top + r.height / 2 ? i : i + 1;
                        if (dropAt?.bucket !== b.id || dropAt.index !== index) setDropAt({ bucket: b.id, index });
                      }}
                    >
                      {dropAt?.bucket === b.id && dropAt.index === i && dragId !== t.id && (
                        <div className="mb-2 h-1 rounded-full" style={{ backgroundColor: cc }} aria-hidden />
                      )}
                      {card(t, cc)}
                    </div>
                  ))}
                  {dropAt?.bucket === b.id && dropAt.index === open.length && open.length > 0 && (
                    <div className="h-1 rounded-full" style={{ backgroundColor: cc }} aria-hidden />
                  )}
                  {!open.length && <p className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-muted">{dragId ? "Drop here" : "No tasks"}</p>}
                  {done.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowDone((s) => ({ ...s, [b.id]: !s[b.id] }))}
                        className="w-full rounded-lg px-2 py-1 text-left text-xs text-muted hover:bg-surface"
                      >
                        {showDone[b.id] ? "▾" : "▸"} Completed ({done.length})
                      </button>
                      {showDone[b.id] && done.map((t) => card(t, cc))}
                    </>
                  )}
                </div>
              </section>
            );
          })}
          {board.can_manage && (
            <button
              type="button"
              onDragOver={(e) => {
                if (!dragCol) return;
                e.preventDefault();
                setColOver("end");
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragCol) void dropColumn(null);
              }}
              onClick={() => column("add", null)}
              className="h-fit w-56 shrink-0 rounded-xl border-2 border-dashed border-line px-3 py-3 text-left text-sm text-muted hover:border-accent hover:text-accent"
            >
              ＋ Add column
            </button>
          )}
        </div>
      )}

      {openTask && (
        <TaskPanel
          taskId={openTask}
          projects={projects}
          openHref={`${appUrl}/p/${projectId}?task=${openTask}`}
          onClose={() => setOpenTask(null)}
          onChanged={changed}
          onMove={async (pid) => {
            await run(editSsTask(openTask, { project: pid }));
            if (pid !== projectId) setOpenTask(null);
          }}
          onAssign={async (person, on) => {
            await run(assignTask(openTask, person.id, on));
          }}
          onDelete={async () => {
            if (!confirm("Delete this task?")) return;
            const res = await removeTask(openTask);
            if (!res.ok) return setError(res.error);
            setOpenTask(null);
            await changed();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
