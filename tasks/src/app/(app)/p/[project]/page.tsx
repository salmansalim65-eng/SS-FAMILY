"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, projectPeople, useAppData } from "@/components/data";
import { drag, TASK_SELECT, TaskCard } from "@/components/task-card";
import { TaskDrawer } from "@/components/task-drawer";
import { supabase } from "@/lib/supabase/client";
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
  const canManagePeople =
    workspace?.role === "owner" ||
    workspace?.role === "admin" ||
    (!!me && project?.created_by === me.id);

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

  function dropOn(bucket: Bucket) {
    const t = drag.task;
    drag.task = null;
    setOver(null);
    if (!t || t.bucket_id === bucket.id) return;
    // Into "Done" completes the task; out of it reopens.
    const change: Partial<Task> = { bucket_id: bucket.id };
    if (doneBucket) change.done = bucket.id === doneBucket.id;
    patch(t, change);
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
    const name = prompt("New column name");
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
        `Delete the column "${b.name}"?${n ? ` Its ${n} task${n === 1 ? "" : "s"} move to the first column.` : ""}`,
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
      <div className="flex flex-1 items-start gap-3 overflow-x-auto pb-4">
        {buckets.map((b) => {
          const list = tasks.filter((t) => t.bucket_id === b.id);
          return (
            <section
              key={b.id}
              onDragOver={(e) => {
                if (!drag.task) return;
                e.preventDefault();
                setOver(b.id);
              }}
              onDragLeave={(e) =>
                !e.currentTarget.contains(e.relatedTarget as Node | null) &&
                setOver(null)
              }
              onDrop={(e) => {
                e.preventDefault();
                dropOn(b);
              }}
              className={`flex max-h-[calc(100dvh-9rem)] w-72 shrink-0 flex-col rounded-2xl bg-surface-2 ${over === b.id ? "ring-2 ring-accent" : ""}`}
            >
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                <button
                  type="button"
                  onDoubleClick={() => renameBucket(b)}
                  title="Double-click to rename"
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold"
                >
                  {b.name}
                </button>
                <span className="text-xs text-muted">{list.length}</span>
                <button
                  type="button"
                  onClick={() => deleteBucket(b)}
                  aria-label={`Delete ${b.name}`}
                  className="text-xs text-muted hover:text-danger"
                >
                  ✕
                </button>
              </div>
              <AddTask onAdd={(title) => addTask(b, title)} />
              <div className="min-h-10 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onOpen={() => setOpen(t.id)}
                    onToggle={() => toggle(t)}
                  />
                ))}
              </div>
            </section>
          );
        })}
        <button
          type="button"
          onClick={addBucket}
          className="w-56 shrink-0 rounded-2xl border-2 border-dashed border-line px-3 py-3 text-sm text-muted hover:text-fg"
        >
          ＋ Add column
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
      `Delete "${project!.name}" for good?\n\nIts ${taskCount} task${taskCount === 1 ? "" : "s"}, columns, checklists and comments are deleted too. This cannot be undone.\n\nType the project name to confirm:`,
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
  const { projects, members, projectMembers, people, me, reload } = data;
  const project = projects.find((p) => p.id === projectId);
  const [error, setError] = useState<string | null>(null);
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
  const inProject = team
    .filter(
      (m) => m.role === "owner" || m.role === "admin" || added.has(m.user_id),
    )
    .sort((a, b) => name(a.user_id).localeCompare(name(b.user_id)));
  const needle = q.trim().toLowerCase();
  const others = team
    .filter(
      (m) => m.role !== "owner" && m.role !== "admin" && !added.has(m.user_id),
    )
    .filter(
      (m) =>
        !needle ||
        `${name(m.user_id)} ${people.get(m.user_id)?.email ?? ""}`
          .toLowerCase()
          .includes(needle),
    )
    .sort((a, b) => name(a.user_id).localeCompare(name(b.user_id)));

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
          Like a Teams channel: only the people here can open this project.
          Owners and admins see every project. Each person sees only their own
          tasks.
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
              <li key={m.user_id} className="flex items-center gap-2 px-3 py-2">
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
                {m.role === "owner" || m.role === "admin" ? (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] capitalize text-muted">
                    {m.role} · all projects
                  </span>
                ) : (
                  canManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(m.user_id)}
                      className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-danger hover:text-danger"
                    >
                      Remove
                    </button>
                  )
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
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <Avatar person={people.get(m.user_id)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{name(m.user_id)}</p>
                      <p className="truncate text-xs text-muted">
                        {people.get(m.user_id)?.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => add(m.user_id)}
                      className="rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      ＋ Add
                    </button>
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
