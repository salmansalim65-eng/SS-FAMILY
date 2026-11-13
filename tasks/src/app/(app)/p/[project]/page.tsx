"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, projectPeople, useAppData } from "@/components/data";
import { drag, TASK_SELECT, TaskCard } from "@/components/task-card";
import { TaskDrawer } from "@/components/task-drawer";
import { dmy, todayKey } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";

// One colour per column, in order (repeats after the last) — the same as the dashboard's board.
const COLUMN_COLORS = ["#1f3a5f", "#2f6f62", "#7a3b3f", "#6b4e71", "#a67c2e", "#3f6e4a", "#4a6c8c", "#8c5a3c", "#4d5d8a", "#6e7f5c", "#5c6b73", "#9a6b4f"]; // muted, "English" tones: navy, teal, burgundy, plum, antique gold, racing green, slate, terracotta, indigo, sage, graphite, tan
import type { Bucket, Task } from "@/lib/types";

function Board() {
  const { project: projectId } = useParams<{ project: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const data = useAppData();
  const { projects, workspaces, me } = data;
  const project = projects.find((p) => p.id === projectId);
  const workspace = workspaces.find((w) => w.id === project?.workspace_id);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showPeople, setShowPeople] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [open, setOpen] = useState<string | null>(search.get("task"));
  const [over, setOver] = useState<string | null>(null);
  // Where a dragged task would land: before the task at `index` in that column.
  const [dropAt, setDropAt] = useState<{ bucket: string; index: number } | null>(null);
  // A column being dragged to a new place, and the column it would go before.
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [colOver, setColOver] = useState<string | null>(null);
  const [showDone, setShowDone] = useState<Record<string, boolean>>({}); // completed tasks open, per column
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [b, t] = await Promise.all([
      sb
        .from("buckets")
        .select("*")
        .eq("project_id", projectId)
        .order("position"),
      sb
        .from("tasks")
        .select(TASK_SELECT)
        .eq("project_id", projectId)
        .order("position")
        .order("created_at"),
    ]);
    setBuckets((b.data ?? []) as Bucket[]);
    setTasks((t.data ?? []) as Task[]);
  }, [projectId]);

  useEffect(() => {
    load();
    const ch = supabase()
      .channel(`board-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `project_id=eq.${projectId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase().removeChannel(ch);
    };
  }, [load, projectId]);

  // Who can be given a task here: the people who can open this project.
  const assignable = useMemo(
    () => projectPeople(data, projectId),
    [data, projectId],
  );
  // Project owners manage the project (people, settings, delete).
  const canManagePeople =
    !!me &&
    data.projectMembers.some(
      (x) => x.project_id === projectId && x.user_id === me.id && x.role === "owner",
    );
  const [takeover, setTakeover] = useState<{ user_id: string; created_at: string } | null>(null);
  useEffect(() => {
    supabase()
      .from("project_takeovers")
      .select("user_id, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data: rows }) => setTakeover((rows?.[0] as { user_id: string; created_at: string } | undefined) ?? null));
  }, [projectId]);

  // A drag that ends anywhere (dropped outside, or Esc) clears the drop markers.
  useEffect(() => {
    const clear = () => {
      setDropAt(null);
      setOver(null);
      setColOver(null);
    };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  const doneBucket = buckets.find((b) => b.name.toLowerCase() === "done");

  async function patch(task: Task, change: Partial<Task>) {
    setTasks((ts) =>
      ts.map((t) => (t.id === task.id ? { ...t, ...change } : t)),
    );
    const { error } = await supabase()
      .from("tasks")
      .update(change)
      .eq("id", task.id);
    if (error) {
      setError(error.message);
      load();
    }
  }

  /** Open tasks of a column in board order. */
  const openIn = (bucketId: string) =>
    tasks.filter((t) => t.bucket_id === bucketId && !t.done).sort((a, b) => a.position - b.position);

  /** Drops the dragged task into a column, before the open task at `index` (or at the end). */
  function dropOn(bucket: Bucket, index?: number) {
    const t = drag.task;
    drag.task = null;
    setOver(null);
    setDropAt(null);
    if (!t) return;
    const list = openIn(bucket.id).filter((x) => x.id !== t.id);
    const at = Math.max(0, Math.min(index ?? list.length, list.length));
    const prev = list[at - 1]?.position;
    const next = list[at]?.position;
    const position =
      prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1 : next !== undefined ? next - 1 : 1;
    if (t.bucket_id === bucket.id && t.position === position) return;
    const change: Partial<Task> = { bucket_id: bucket.id, position };
    // Into "Done" completes the task; out of it reopens.
    if (doneBucket && t.bucket_id !== bucket.id) change.done = bucket.id === doneBucket.id;
    patch(t, change);
  }

  /** Moves a dragged column before `target` (or to the end), renumbering the columns. */
  async function moveColumn(target: string | null) {
    const from = dragCol;
    setDragCol(null);
    setColOver(null);
    if (!from || from === target) return;
    const order = buckets.filter((b) => b.id !== from);
    const at = target ? order.findIndex((b) => b.id === target) : order.length;
    const moved = buckets.find((b) => b.id === from);
    if (!moved) return;
    order.splice(at < 0 ? order.length : at, 0, moved);
    const renumbered = order.map((b, i) => ({ ...b, position: i + 1 }));
    setBuckets(renumbered);
    const sb = supabase();
    const changed = renumbered.filter((b) => buckets.find((x) => x.id === b.id)?.position !== b.position);
    const results = await Promise.all(changed.map((b) => sb.from("buckets").update({ position: b.position }).eq("id", b.id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error.message);
      load();
    }
  }

  function toggle(t: Task) {
    const done = !t.done;
    const change: Partial<Task> = { done };
    if (doneBucket && done) change.bucket_id = doneBucket.id;
    if (doneBucket && !done && t.bucket_id === doneBucket.id)
      change.bucket_id = buckets[0]?.id ?? null;
    patch(t, change);
  }

  async function addTask(bucket: Bucket, title: string) {
    const position =
      Math.max(
        0,
        ...tasks
          .filter((t) => t.bucket_id === bucket.id)
          .map((t) => t.position),
      ) + 1;
    const { error } = await supabase()
      .from("tasks")
      .insert({
        project_id: projectId,
        bucket_id: bucket.id,
        title,
        position,
        done: bucket.id === doneBucket?.id,
      });
    if (error) return setError(error.message);
    load();
  }

  async function addBucket() {
    const name = prompt("New bucket name");
    if (!name?.trim()) return;
    const { error } = await supabase()
      .from("buckets")
      .insert({
        project_id: projectId,
        name: name.trim(),
        position: (buckets.at(-1)?.position ?? 0) + 1,
      });
    if (error) return setError(error.message);
    load();
  }

  async function renameBucket(b: Bucket) {
    const name = prompt("Column name", b.name);
    if (!name?.trim() || name.trim() === b.name) return;
    await supabase()
      .from("buckets")
      .update({ name: name.trim() })
      .eq("id", b.id);
    load();
  }

  async function deleteBucket(b: Bucket) {
    const n = tasks.filter((t) => t.bucket_id === b.id).length;
    if (
      !confirm(
        `Delete the bucket "${b.name}"?${n ? ` Its ${n} task${n === 1 ? "" : "s"} move to the first bucket.` : ""}`,
      )
    )
      return;
    const first = buckets.find((x) => x.id !== b.id);
    if (first)
      await supabase()
        .from("tasks")
        .update({ bucket_id: first.id })
        .eq("bucket_id", b.id);
    await supabase().from("buckets").delete().eq("id", b.id);
    load();
  }

  if (!project) return <p className="text-sm text-muted">Loading project…</p>;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/w/${project.workspace_id}`}
          className="text-sm text-muted hover:text-fg"
        >
          {workspace?.name} /
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <span
            className="size-3 rounded-full"
            style={{ background: project.color }}
            aria-hidden
          />
          {project.name}
        </h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowPeople(true)}
          className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1.5 pr-3 text-sm hover:bg-surface-2"
          title="Who can open this project"
        >
          <span className="flex -space-x-2">
            {assignable.slice(0, 4).map((p) => (
              <Avatar key={p.id} person={p} size="xs" />
            ))}
          </span>
          👥 Members ({assignable.length})
        </button>
        {workspace?.role !== "guest" && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-sm hover:bg-surface-2"
            title="Rename, colour, archive or delete this project"
          >
            ⚙ Project
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {takeover && (
        <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          🛡 {data.people.get(takeover.user_id)?.full_name || "The workspace owner"} took ownership of this project on{" "}
          {new Date(takeover.created_at).toLocaleDateString("en-GB")}.
        </p>
      )}
      <div className="flex flex-1 items-start gap-3 overflow-x-auto pb-4">
        {buckets.map((b, bi) => {
          const cc = COLUMN_COLORS[bi % COLUMN_COLORS.length];
          const all = tasks.filter((t) => t.bucket_id === b.id);
          const list = all.filter((t) => !t.done).sort((x, y) => x.position - y.position);
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
                if (!drag.task) return;
                e.preventDefault();
                setOver(b.id);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setOver(null);
                setDropAt((d) => (d?.bucket === b.id ? null : d));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragCol) return moveColumn(b.id);
                dropOn(b, dropAt?.bucket === b.id ? dropAt.index : undefined);
              }}
              className={`flex max-h-[calc(100dvh-9rem)] w-72 shrink-0 flex-col rounded-2xl bg-surface-2 ${over === b.id ? "ring-2 ring-accent" : ""} ${
                colOver === b.id && dragCol !== b.id ? "border-l-4 border-accent" : ""
              } ${dragCol === b.id ? "opacity-40" : ""}`}
              style={{ backgroundColor: `color-mix(in srgb, ${cc} 7%, transparent)`, borderTop: `4px solid ${cc}` }}
            >
              <div
                className="flex cursor-grab items-center gap-2 rounded-t-xl px-3 pb-2 pt-2.5 active:cursor-grabbing"
                style={{ backgroundColor: `color-mix(in srgb, ${cc} 16%, transparent)` }}
                draggable
                title="Drag to move the bucket"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", b.name);
                  setDragCol(b.id);
                }}
                onDragEnd={() => {
                  setDragCol(null);
                  setColOver(null);
                }}
              >
                <span aria-hidden className="text-xs" style={{ color: cc }}>⠿</span>
                <button
                  type="button"
                  onDoubleClick={() => renameBucket(b)}
                  title="Double-click to rename"
                  className="min-w-0 flex-1 truncate text-left text-sm font-bold"
                  style={{ color: cc }}
                >
                  {b.name}
                </button>
                <span className="rounded-full px-2 text-xs font-semibold text-white" style={{ backgroundColor: cc }}>{list.length}</span>
                <button
                  type="button"
                  onClick={() => deleteBucket(b)}
                  aria-label={`Delete ${b.name}`}
                  className="text-xs text-muted hover:text-danger"
                >
                  ✕
                </button>
              </div>
              {b.due_date && (
                <p className="px-3 pt-1 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${b.due_date < todayKey() ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : "bg-surface text-muted"}`}>
                    {b.due_date < todayKey() ? "⚠ " : "📅 "}Bucket due {dmy(b.due_date)}
                  </span>
                </p>
              )}
              <AddTask onAdd={(title) => addTask(b, title)} />
              <div className="min-h-10 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((t, i) => (
                  <div
                    key={t.id}
                    onDragOver={(e) => {
                      if (!drag.task || dragCol) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      const index = e.clientY < r.top + r.height / 2 ? i : i + 1;
                      if (dropAt?.bucket !== b.id || dropAt.index !== index) setDropAt({ bucket: b.id, index });
                    }}
                  >
                    {dropAt?.bucket === b.id && dropAt.index === i && drag.task?.id !== t.id && (
                      <div className="mb-2 h-1 rounded-full" style={{ backgroundColor: cc }} aria-hidden />
                    )}
                    <TaskCard task={t} onOpen={() => setOpen(t.id)} onToggle={() => toggle(t)} />
                  </div>
                ))}
                {dropAt?.bucket === b.id && dropAt.index === list.length && list.length > 0 && (
                  <div className="h-1 rounded-full" style={{ backgroundColor: cc }} aria-hidden />
                )}
                {done.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowDone((s) => ({ ...s, [b.id]: !s[b.id] }))}
                      className="w-full rounded-lg px-2 py-1 text-left text-xs text-muted hover:bg-surface hover:text-fg"
                    >
                      {showDone[b.id] ? "▾" : "▸"} Completed tasks ({done.length})
                    </button>
                    {showDone[b.id] &&
                      done.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          onOpen={() => setOpen(t.id)}
                          onToggle={() => toggle(t)}
                        />
                      ))}
                  </>
                )}
              </div>
            </section>
          );
        })}
        <button
          type="button"
          onDragOver={(e) => {
            if (!dragCol) return;
            e.preventDefault();
            setColOver("end");
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragCol) moveColumn(null);
          }}
          onClick={addBucket}
          className="w-56 shrink-0 rounded-2xl border-2 border-dashed border-line px-3 py-3 text-sm text-muted hover:text-fg"
        >
          ＋ Add bucket
        </button>
      </div>
      {showSettings && (
        <ProjectSettings
          projectId={projectId}
          canDelete={canManagePeople}
          taskCount={tasks.length}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showPeople && (
        <ProjectPeople
          projectId={projectId}
          canManage={canManagePeople}
          onClose={() => setShowPeople(false)}
        />
      )}
      {open && (
        <TaskDrawer
          taskId={open}
          buckets={buckets}
          assignable={assignable}
          onClose={() => {
            setOpen(null);
            if (search.get("task")) router.replace(`/p/${projectId}`);
          }}
          onChanged={load}
        />
      )}
    </div>
  );
}

const COLOURS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#64748b",
];

/** Rename, recolour, archive or delete a project. Deleting is for owners/admins and the project's creator. */
function ProjectSettings({
  projectId,
  canDelete,
  taskCount,
  onClose,
}: {
  projectId: string;
  canDelete: boolean;
  taskCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const { projects, reload } = useAppData();
  const project = projects.find((p) => p.id === projectId);
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? COLOURS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!project) return null;

  async function save() {
    if (!name.trim()) return setError("The project needs a name.");
    setBusy(true);
    setError(null);
    const { data, error } = await supabase()
      .from("projects")
      .update({ name: name.trim(), color })
      .eq("id", projectId)
      .select("id");
    setBusy(false);
    if (error) return setError(error.message);
    if (!data?.length) return setError("You can't change this project.");
    await reload();
    onClose();
  }

  async function archive() {
    if (
      !confirm(
        `Archive "${project!.name}"? It disappears from the list for everyone; its tasks are kept.`,
      )
    )
      return;
    setBusy(true);
    const { data, error } = await supabase()
      .from("projects")
      .update({ archived: true })
      .eq("id", projectId)
      .select("id");
    setBusy(false);
    if (error) return setError(error.message);
    if (!data?.length) return setError("You can't archive this project.");
    await reload();
    router.replace(`/w/${project!.workspace_id}`);
  }

  async function remove() {
    const typed = prompt(
      `Delete "${project!.name}" for good?\n\nIts ${taskCount} task${taskCount === 1 ? "" : "s"}, columns, checklists and comments are deleted too. This cannot be undone.\n\nPress OK to delete (the name is filled in for you):`,
      project!.name,
    );
    if (typed === null) return;
    if (typed.trim() !== project!.name.trim())
      return setError("The name didn't match, so nothing was deleted.");
    setBusy(true);
    const { data, error } = await supabase()
      .from("projects")
      .delete()
      .eq("id", projectId)
      .select("id");
    setBusy(false);
    if (error) return setError(error.message);
    if (!data?.length)
      return setError(
        "Only the workspace owner/admin or the person who made this project can delete it.",
      );
    await reload();
    router.replace(`/w/${project!.workspace_id}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <span
            className="size-3 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
          <h2 className="min-w-0 flex-1 truncate font-semibold">
            {project.name} · Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-muted hover:text-fg"
          >
            ✕
          </button>
        </div>
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <section className="space-y-3 rounded-xl border border-line p-3">
          <label className="block text-sm font-medium">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              dir="auto"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-normal outline-none focus:border-accent"
            />
          </label>
          <div>
            <p className="text-sm font-medium">Colour</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Colour ${c}`}
                  className={`size-7 rounded-full ${color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="w-full rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
        </section>

        {canDelete && (
          <section className="space-y-2 rounded-xl border border-line p-3">
            <p className="text-sm font-medium">Archive</p>
            <p className="text-xs text-muted">
              Hide the project from everyone's list. Tasks are kept.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={archive}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              🗄 Archive project
            </button>
          </section>
        )}

        {canDelete && (
          <section className="space-y-2 rounded-xl border border-danger/40 p-3">
            <p className="text-sm font-medium text-danger">Delete</p>
            <p className="text-xs text-muted">
              Deletes the project and all its tasks for everyone. Cannot be
              undone. (A list synced from Google Tasks comes back on the next
              sync — delete it in Google Tasks instead.)
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="w-full rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
            >
              🗑 Delete project
            </button>
          </section>
        )}
      </aside>
    </div>
  );
}

/**
 * Who can open this project — like a Teams channel: the workspace's owners and
 * admins always, everyone else only once added here. Owners, admins and the
 * project's creator add and remove people.
 */
function ProjectPeople({
  projectId,
  canManage,
  onClose,
}: {
  projectId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const data = useAppData();
  const { projects, members, projectMembers, people, me, reload, workspaces } = data;
  const project = projects.find((p) => p.id === projectId);
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<{ userId: string; link: string } | null>(null);
  const isOwner = workspaces.find((w) => w.id === project?.workspace_id)?.role === "owner";

  // A one-time link (1 hour) the person opens to choose a new password; workspace owners only.
  async function makeResetLink(userId: string) {
    setError(null);
    setResetLink(null);
    const { data: token, error } = await supabase().rpc("create_password_reset", { p_user: userId });
    if (error) return setError(error.message);
    const link = `${location.origin}/reset/${token as string}`;
    setResetLink({ userId, link });
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
  }
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!project) return null;
  const team = members.filter((m) => m.workspace_id === project.workspace_id);
  const added = new Set(
    projectMembers
      .filter((x) => x.project_id === projectId)
      .map((x) => x.user_id),
  );
  const name = (id: string) =>
    people.get(id)?.full_name || people.get(id)?.email || "Someone";
  const owners = new Set(
    projectMembers
      .filter((x) => x.project_id === projectId && x.role === "owner")
      .map((x) => x.user_id),
  );
  const inProject = team
    .filter((m) => added.has(m.user_id))
    .sort(
      (a, b) =>
        Number(owners.has(b.user_id)) - Number(owners.has(a.user_id)) ||
        name(a.user_id).localeCompare(name(b.user_id)),
    );
  const needle = q.trim().toLowerCase();
  const others = team
    .filter((m) => !added.has(m.user_id))
    .filter(
      (m) =>
        !needle ||
        `${name(m.user_id)} ${people.get(m.user_id)?.email ?? ""}`
          .toLowerCase()
          .includes(needle),
    )
    .sort((a, b) => name(a.user_id).localeCompare(name(b.user_id)));

  async function setOwner(userId: string, on: boolean) {
    setBusy(true);
    setError(null);
    const { data: rows, error } = await supabase()
      .from("project_members")
      .update({ role: on ? "owner" : "member" })
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .select("user_id");
    setBusy(false);
    if (error) return setError(error.message);
    if (!rows?.length) return setError("Only a project owner can change owners.");
    reload();
  }

  async function add(userId: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase()
      .from("project_members")
      .insert({ project_id: projectId, user_id: userId });
    setBusy(false);
    if (error) return setError(error.message);
    reload();
  }
  async function remove(userId: string) {
    if (
      !confirm(
        `Remove ${name(userId)} from ${project!.name}? They will no longer see this project.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const { data: gone, error } = await supabase()
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .select("user_id");
    setBusy(false);
    if (error) return setError(error.message);
    if (!gone?.length)
      return setError("You can't remove people from this project.");
    reload();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto bg-surface p-4 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <span
            className="size-3 rounded-full"
            style={{ background: project.color }}
            aria-hidden
          />
          <h2 className="min-w-0 flex-1 truncate font-semibold">
            {project.name} · Members
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-muted hover:text-fg"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-muted">
          Private: only the people here can open this project (like a Teams
          channel). Project owners manage it and see every task; everyone else
          sees only their own tasks.
        </p>
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <section className="overflow-hidden rounded-xl border border-line">
          <p className="border-b border-line bg-surface-2 px-3 py-1.5 text-sm font-medium">
            In this project ({inProject.length})
          </p>
          <ul className="divide-y divide-line">
            {inProject.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Avatar person={people.get(m.user_id)} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {name(m.user_id)}{" "}
                    {m.user_id === me?.id && (
                      <span className="text-muted">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {people.get(m.user_id)?.email}
                  </p>
                </div>
                {owners.has(m.user_id) && (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                    Project owner
                  </span>
                )}
                <span className="flex items-center gap-1">
                  {isOwner && (m.role === "member" || m.role === "guest") && m.user_id !== me?.id && (
                    <button
                      type="button"
                      onClick={() => makeResetLink(m.user_id)}
                      title="Make a one-time link to choose a new password"
                      aria-label={`Reset password for ${name(m.user_id)}`}
                      className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
                    >
                      🔑
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setOwner(m.user_id, !owners.has(m.user_id))}
                      className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
                    >
                      {owners.has(m.user_id) ? "Remove owner" : "Make owner"}
                    </button>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(m.user_id)}
                      className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-danger hover:text-danger"
                    >
                      Remove
                    </button>
                  )}
                </span>
                {resetLink?.userId === m.user_id && (
                  <div className="mt-1 flex w-full flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
                    <span>✓ Reset link copied (works once, 1 hour):</span>
                    <code className="min-w-0 flex-1 truncate">{resetLink.link}</code>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(`Task Hub password reset link (works once, for 1 hour): ${resetLink.link}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline"
                    >
                      WhatsApp
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {canManage && (
          <section className="overflow-hidden rounded-xl border border-line">
            <p className="border-b border-line bg-surface-2 px-3 py-1.5 text-sm font-medium">
              Add from the workspace
            </p>
            <div className="p-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name"
                className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
            {others.length === 0 ? (
              <p className="px-3 pb-3 text-xs text-muted">
                {needle
                  ? "Nobody matches."
                  : "Everyone in the workspace is already here."}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                {others.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex flex-wrap items-center gap-2 px-3 py-2"
                  >
                    <Avatar person={people.get(m.user_id)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{name(m.user_id)}</p>
                      <p className="truncate text-xs text-muted">
                        {people.get(m.user_id)?.email}
                      </p>
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => makeResetLink(m.user_id)}
                        title="Reset password"
                        aria-label={`Reset password for ${name(m.user_id)}`}
                        className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
                      >
                        🔑
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => add(m.user_id)}
                      className="rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      ＋ Add
                    </button>
                    {resetLink?.userId === m.user_id && (
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
                        <span>✓ Reset link copied (works once, 1 hour):</span>
                        <code className="min-w-0 flex-1 truncate">{resetLink.link}</code>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(`Task Hub password reset link (works once, for 1 hour): ${resetLink.link}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline"
                        >
                          WhatsApp
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {canManage && (
          <Link
            href={`/w/${project.workspace_id}/members?project=${project.id}`}
            className="rounded-xl border border-dashed border-line px-3 py-2 text-center text-sm text-accent hover:bg-surface-2"
          >
            ✉ Invite someone new by email
          </Link>
        )}
      </aside>
    </div>
  );
}

function AddTask({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mx-2 mb-2 rounded-lg px-2 py-1.5 text-left text-sm text-accent hover:bg-surface"
      >
        ＋ Add a task
      </button>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await onAdd(text.trim());
        setText("");
      }}
      className="mx-2 mb-2"
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text.trim() && setEditing(false)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        placeholder="Task name, then Enter"
        dir="auto"
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
    </form>
  );
}

export default function ProjectPage() {
  return (
    <Suspense>
      <Board />
    </Suspense>
  );
}
