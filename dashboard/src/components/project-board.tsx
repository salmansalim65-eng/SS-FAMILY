"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addSsTask, applyTask, assignTask, createBucket, editColumn, editSsTask, moveColumnTo, placeTask, projectBoard, removeTask, saveBucket } from "@/app/sstasks/actions";
import { TaskPanel } from "@/components/task-panel";
import { karachiToday } from "@/lib/time";
import type { SsBoardTask, SsProjectBoard } from "@/lib/sstasks";

type Project = { id: string; name: string; workspace: string };

const GRAY = "#94a3b8";
// One colour per column, in order (repeats after the last).
const COLUMN_COLORS = ["#1f3a5f", "#2f6f62", "#7a3b3f", "#6b4e71", "#a67c2e", "#3f6e4a", "#4a6c8c", "#8c5a3c", "#4d5d8a", "#6e7f5c", "#5c6b73", "#9a6b4f"]; // muted, "English" tones: navy, teal, burgundy, plum, antique gold, racing green, slate, terracotta, indigo, sage, graphite, tan
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
const dueFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
type View = "late" | "today" | "week" | "high" | "unassigned";
const VIEWS: { key: View; label: string }[] = [
  { key: "late", label: "⚠ Late" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "high", label: "Urgent & important" },
  { key: "unassigned", label: "Not assigned" },
];
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
  // The new-bucket / bucket-settings window: null, a new one, or an existing bucket's id.
  const [bucketForm, setBucketForm] = useState<"new" | string | null>(null);
  // the views above the board: tasks shown in every column (several may be on together)
  const [views, setViews] = useState<Set<View>>(new Set());
  const [person, setPerson] = useState("");
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
      name = prompt(action === "add" ? "New bucket name" : "Bucket name", current ?? "");
      if (!name?.trim()) return;
    }
    if (action === "delete" && !confirm(`Delete the bucket "${current}"? (Only an empty bucket can be deleted.)`)) return;
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

  const nameOf = (id: string) => board?.people?.find((p) => p.id === id)?.name ?? "Someone";

  const colOfId = (t: SsBoardTask) =>
    t.bucket_id && (board?.buckets ?? []).some((b) => b.id === t.bucket_id) ? t.bucket_id : board?.buckets[0]?.id;

  if (typeof document === "undefined") return null;
  const color = board?.project.color || GRAY;
  const buckets = board?.buckets ?? [];
  // the views: Late / Today / This week by the due date (Karachi day), Urgent & important, Not assigned, one person
  const weekEnd = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const filtering = views.size > 0 || person !== "";
  const passes = (t: SsBoardTask) => {
    if (!filtering) return true;
    if (views.has("late") && !(t.due && t.due < today)) return false;
    if (views.has("today") && t.due !== today) return false;
    if (views.has("week") && !(t.due && t.due >= today && t.due <= weekEnd)) return false;
    if (views.has("high") && t.priority !== "urgent" && t.priority !== "important") return false;
    if (views.has("unassigned") && t.assignees.length > 0) return false;
    if (person && !t.assignees.includes(person)) return false;
    return true;
  };
  const people = [...new Set((board?.tasks ?? []).flatMap((t) => t.assignees))].sort((x, y) => x.localeCompare(y));
  const shownOpen = (board?.tasks ?? []).filter((t) => !t.done && passes(t)).length;
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
      {/* the band: slim, one line; a soft, muted sand-gold (a deep warm brown in dark mode) */}
      <header className="flex flex-wrap items-center gap-2 border-b border-[#e3d9c4] bg-[#f4efe4] px-4 py-1.5 text-[#3d3324] dark:border-[#3a3326] dark:bg-[#26221b] dark:text-[#ece4d2]">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <h2 className="truncate text-sm font-semibold tracking-wide">{board?.project.name ?? "Loading…"}</h2>
        {board && (
          <span className="flex items-center gap-1.5 text-[11px] text-[#7a6a4d] dark:text-[#b9ab8c]">
            <span>{board.project.workspace}</span>
            <span className="rounded-full bg-[#e6dac0] px-1.5 font-medium text-[#5c4a26] dark:bg-[#4a3f2a] dark:text-[#ecdcb6]">{board.tasks.filter((t) => !t.done).length} open</span>
            <span className="rounded-full bg-[#ece5d6] px-1.5 dark:bg-[#332d22]">{board.tasks.filter((t) => t.done).length} done</span>
          </span>
        )}
        <div className="flex-1" />
        <button type="button" onClick={onMembers} className="rounded-full border border-[#dccfb3] bg-[#faf7f0] px-2.5 py-0.5 text-xs transition hover:bg-white dark:border-[#4a412f] dark:bg-[#2f2a21] dark:hover:bg-[#3a3326]">
          👥 Members
        </button>
        <button type="button" onClick={() => load()} title="Refresh" className="rounded-full border border-[#dccfb3] bg-[#faf7f0] px-2 py-0.5 text-xs transition hover:bg-white dark:border-[#4a412f] dark:bg-[#2f2a21] dark:hover:bg-[#3a3326]">
          ↻
        </button>
        <button type="button" onClick={onClose} className="rounded-full bg-[#8a7650] px-2.5 py-0.5 text-xs font-semibold text-white transition hover:bg-[#776544] dark:bg-[#6b5c3e] dark:hover:bg-[#7a6a48]">
          ✕ Close
        </button>
      </header>

      {board && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2">
          {VIEWS.map((v) => {
            const on = views.has(v.key);
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setViews((s) => {
                    const n = new Set(s);
                    if (on) n.delete(v.key);
                    else n.add(v.key);
                    return n;
                  })
                }
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-white" : "border-line hover:bg-surface-2"}`}
              >
                {v.label}
              </button>
            );
          })}
          <select
            aria-label="Assigned to"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className={`rounded-full border px-3 py-1 text-sm outline-none ${person ? "border-accent bg-accent text-white" : "border-line bg-surface"}`}
          >
            <option value="">Assigned to: anyone</option>
            {people.map((n) => (
              <option key={n} value={n}>
                Assigned to: {n}
              </option>
            ))}
          </select>
          {filtering && (
            <>
              <span className="text-xs text-muted">
                {shownOpen} of {board.tasks.filter((t) => !t.done).length} open tasks shown
              </span>
              <button
                type="button"
                onClick={() => {
                  setViews(new Set());
                  setPerson("");
                }}
                className="rounded-full px-2 py-1 text-xs text-muted hover:text-fg"
              >
                ✕ Clear
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="mx-4 mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!board && !error && <p className="p-6 text-sm text-muted">Loading board…</p>}

      {board && (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4 [scrollbar-width:thin]">
          {buckets.map((b, bi) => {
            const cc = COLUMN_COLORS[bi % COLUMN_COLORS.length];
            const all = board.tasks.filter((t) => colOf(t) === b.id && passes(t));
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
                  // with a view on, the place among the hidden tasks is not known: the task goes to the column's end
                  dropTask(b.id, !filtering && dropAt?.bucket === b.id ? dropAt.index : undefined);
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
                      <button
                        type="button"
                        onClick={() => {
                          setColMenu(null);
                          setBucketForm(b.id);
                        }}
                        className="block w-full px-3 py-1.5 text-left hover:bg-surface-2"
                      >
                        ⚙ Name, due date &amp; members
                      </button>
                      <button type="button" onClick={() => column("left", b.id)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                        ← Move left
                      </button>
                      <button type="button" onClick={() => column("right", b.id)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                        → Move right
                      </button>
                      <button type="button" onClick={() => column("delete", b.id, b.name)} className="block w-full px-3 py-1.5 text-left text-danger hover:bg-danger-soft">
                        🗑 Delete bucket
                      </button>
                    </div>
                  )}
                </div>
                {(b.due || (b.members ?? []).length > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5 px-3 pt-1.5 text-xs">
                    {b.due && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${b.due < today ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-surface text-muted"}`}
                        title="Bucket due date"
                      >
                        {b.due < today ? "⚠ " : "📅 "}
                        {dueFmt.format(new Date(`${b.due}T00:00:00Z`))}
                      </span>
                    )}
                    {(b.members ?? []).length > 0 && (
                      <span className="ml-auto flex -space-x-1" title={`Bucket members: ${(b.members ?? []).map((id) => nameOf(id)).join(", ")}`}>
                        {(b.members ?? []).slice(0, 5).map((id) => (
                          <span key={id} className="grid size-[22px] place-items-center rounded-full border-2 border-surface text-[9px] font-semibold text-white" style={{ backgroundColor: cc }}>
                            {initialsOf(nameOf(id))}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )}
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
              onClick={() => setBucketForm("new")}
              className="h-fit w-56 shrink-0 rounded-xl border-2 border-dashed border-line px-3 py-3 text-left text-sm text-muted hover:border-accent hover:text-accent"
            >
              ＋ Add bucket
            </button>
          )}
        </div>
      )}

      {bucketForm && board && (
        <BucketForm
          key={bucketForm}
          projectId={projectId}
          bucket={bucketForm === "new" ? null : (board.buckets.find((b) => b.id === bucketForm) ?? null)}
          people={board.people ?? []}
          onClose={() => setBucketForm(null)}
          onSaved={async () => {
            setBucketForm(null);
            await changed();
          }}
        />
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

/** New bucket (name, due date, members and its tasks) or an existing bucket's settings. */
function BucketForm({
  projectId,
  bucket,
  people,
  onClose,
  onSaved,
}: {
  projectId: string;
  bucket: SsProjectBoard["buckets"][number] | null;
  people: { id: string; name: string; email: string }[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(bucket?.name ?? "");
  const [due, setDue] = useState(bucket?.due ?? "");
  const [members, setMembers] = useState<string[]>(bucket?.members ?? []);
  const [tasks, setTasks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = bucket
      ? await saveBucket(projectId, bucket.id, name, due || null, members)
      : await createBucket(projectId, name, due || null, members, tasks.split("\n"));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    await onSaved();
  }

  const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={bucket ? "Bucket settings" : "New bucket"}
        className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <h3 className="flex-1 font-semibold">{bucket ? "⚙ Bucket settings" : "＋ New bucket"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-1.5 text-muted hover:text-fg">
            ✕
          </button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Hifz admissions" className={field} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Due date (optional — the whole bucket)</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        </label>
        <div className="space-y-1">
          <span className="text-xs text-muted">Members — they see every task in this bucket</span>
          {people.length === 0 ? (
            <p className="text-xs text-muted">Add people to the project first (👥 Members).</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {people.map((p) => {
                const on = members.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMembers((m) => (on ? m.filter((x) => x !== p.id) : [...m, p.id]))}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent bg-accent/10 font-medium text-accent" : "border-line hover:bg-surface-2"}`}
                  >
                    {p.name}
                    {on && " ✓"}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {!bucket && (
          <label className="block space-y-1">
            <span className="text-xs text-muted">Tasks — one per line (not assigned to anyone; they take the bucket&apos;s due date)</span>
            <textarea value={tasks} onChange={(e) => setTasks(e.target.value)} rows={5} placeholder={"Collect forms\nCheck documents\nMake the list"} className={field} />
          </label>
        )}
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Saving…" : bucket ? "Save" : "Create bucket"}
          </button>
        </div>
      </form>
    </div>
  );
}
