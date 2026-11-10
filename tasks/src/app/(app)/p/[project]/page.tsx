"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/data";
import { drag, TASK_SELECT, TaskCard } from "@/components/task-card";
import { TaskDrawer } from "@/components/task-drawer";
import { supabase } from "@/lib/supabase/client";
import type { Bucket, Profile, Task } from "@/lib/types";

function Board() {
  const { project: projectId } = useParams<{ project: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { projects, workspaces, members, people } = useAppData();
  const project = projects.find((p) => p.id === projectId);
  const workspace = workspaces.find((w) => w.id === project?.workspace_id);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [guests, setGuests] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(search.get("task"));
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const [b, t, pm] = await Promise.all([
      sb.from("buckets").select("*").eq("project_id", projectId).order("position"),
      sb.from("tasks").select(TASK_SELECT).eq("project_id", projectId).order("position").order("created_at"),
      sb.from("project_members").select("user_id").eq("project_id", projectId),
    ]);
    setBuckets((b.data ?? []) as Bucket[]);
    setTasks((t.data ?? []) as Task[]);
    setGuests((pm.data ?? []).map((x) => x.user_id as string));
  }, [projectId]);

  useEffect(() => {
    load();
    const ch = supabase()
      .channel(`board-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => {
      supabase().removeChannel(ch);
    };
  }, [load, projectId]);

  // Who can be given a task here: the workspace's members, and guests added to this project.
  const assignable = useMemo(() => {
    if (!project) return [] as Profile[];
    const ids = members
      .filter((m) => m.workspace_id === project.workspace_id && (m.role !== "guest" || guests.includes(m.user_id)))
      .map((m) => m.user_id);
    return ids.map((id) => people.get(id)).filter((p): p is Profile => !!p);
  }, [members, guests, people, project]);

  const doneBucket = buckets.find((b) => b.name.toLowerCase() === "done");

  async function patch(task: Task, change: Partial<Task>) {
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, ...change } : t)));
    const { error } = await supabase().from("tasks").update(change).eq("id", task.id);
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
    if (doneBucket && !done && t.bucket_id === doneBucket.id) change.bucket_id = buckets[0]?.id ?? null;
    patch(t, change);
  }

  async function addTask(bucket: Bucket, title: string) {
    const position = Math.max(0, ...tasks.filter((t) => t.bucket_id === bucket.id).map((t) => t.position)) + 1;
    const { error } = await supabase().from("tasks").insert({ project_id: projectId, bucket_id: bucket.id, title, position, done: bucket.id === doneBucket?.id });
    if (error) return setError(error.message);
    load();
  }

  async function addBucket() {
    const name = prompt("New column name");
    if (!name?.trim()) return;
    const { error } = await supabase()
      .from("buckets")
      .insert({ project_id: projectId, name: name.trim(), position: (buckets.at(-1)?.position ?? 0) + 1 });
    if (error) return setError(error.message);
    load();
  }

  async function renameBucket(b: Bucket) {
    const name = prompt("Column name", b.name);
    if (!name?.trim() || name.trim() === b.name) return;
    await supabase().from("buckets").update({ name: name.trim() }).eq("id", b.id);
    load();
  }

  async function deleteBucket(b: Bucket) {
    const n = tasks.filter((t) => t.bucket_id === b.id).length;
    if (!confirm(`Delete the column "${b.name}"?${n ? ` Its ${n} task${n === 1 ? "" : "s"} move to the first column.` : ""}`)) return;
    const first = buckets.find((x) => x.id !== b.id);
    if (first) await supabase().from("tasks").update({ bucket_id: first.id }).eq("bucket_id", b.id);
    await supabase().from("buckets").delete().eq("id", b.id);
    load();
  }

  if (!project) return <p className="text-sm text-muted">Loading project…</p>;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/w/${project.workspace_id}`} className="text-sm text-muted hover:text-fg">
          {workspace?.name} /
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <span className="size-3 rounded-full" style={{ background: project.color }} aria-hidden />
          {project.name}
        </h1>
        <div className="flex-1" />
        <span className="text-xs text-muted">{assignable.length} people</span>
        {workspace?.role !== "guest" && (
          <Link href={`/w/${project.workspace_id}/members?project=${project.id}`} className="rounded-full border border-line bg-surface px-3 py-1 text-sm hover:bg-surface-2">
            ＋ Invite guest
          </Link>
        )}
      </div>
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
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
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(b);
              }}
              className={`flex max-h-[calc(100dvh-9rem)] w-72 shrink-0 flex-col rounded-2xl bg-surface-2 ${over === b.id ? "ring-2 ring-accent" : ""}`}
            >
              <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                <button type="button" onDoubleClick={() => renameBucket(b)} title="Double-click to rename" className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                  {b.name}
                </button>
                <span className="text-xs text-muted">{list.length}</span>
                <button type="button" onClick={() => deleteBucket(b)} aria-label={`Delete ${b.name}`} className="text-xs text-muted hover:text-danger">
                  ✕
                </button>
              </div>
              <AddTask onAdd={(title) => addTask(b, title)} />
              <div className="min-h-10 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((t) => (
                  <TaskCard key={t.id} task={t} onOpen={() => setOpen(t.id)} onToggle={() => toggle(t)} />
                ))}
              </div>
            </section>
          );
        })}
        <button type="button" onClick={addBucket} className="w-56 shrink-0 rounded-2xl border-2 border-dashed border-line px-3 py-3 text-sm text-muted hover:text-fg">
          ＋ Add column
        </button>
      </div>
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

function AddTask({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)} className="mx-2 mb-2 rounded-lg px-2 py-1.5 text-left text-sm text-accent hover:bg-surface">
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
