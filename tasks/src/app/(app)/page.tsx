"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppData } from "@/components/data";
import { TASK_SELECT, TaskCard } from "@/components/task-card";
import { TaskDrawer } from "@/components/task-drawer";
import { addDaysKey, todayKey } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";
import type { Bucket, Profile, Task } from "@/lib/types";

type View = "mine" | "by_me";

/** Every task given to me (or that I gave), across all workspaces, by when it's due. */
export default function MyTasks() {
  const { me, projects, workspaces, members, people } = useAppData();
  const [view, setView] = useState<View>("mine");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState<Task | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  const load = useCallback(async () => {
    if (!me) return;
    const sb = supabase();
    if (view === "mine") {
      const { data: mine } = await sb.from("task_assignees").select("task_id").eq("user_id", me.id);
      const ids = (mine ?? []).map((x) => x.task_id as string);
      const { data } = ids.length ? await sb.from("tasks").select(TASK_SELECT).in("id", ids).eq("done", false) : { data: [] };
      setTasks((data ?? []) as Task[]);
    } else {
      const { data } = await sb.from("tasks").select(TASK_SELECT).eq("created_by", me.id).eq("done", false);
      setTasks(((data ?? []) as Task[]).filter((t) => (t.task_assignees ?? []).some((a) => a.user_id !== me.id)));
    }
  }, [me, view]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    supabase()
      .from("buckets")
      .select("*")
      .eq("project_id", open.project_id)
      .order("position")
      .then(({ data }) => setBuckets((data ?? []) as Bucket[]));
  }, [open]);

  const groups = useMemo(() => {
    const t = todayKey();
    const week = addDaysKey(t, 7);
    const by = (f: (x: Task) => boolean) => tasks.filter(f);
    return [
      { key: "late", title: "Late", tone: "text-danger", items: by((x) => !!x.due_date && x.due_date < t) },
      { key: "today", title: "Today", tone: "text-accent", items: by((x) => x.due_date === t) },
      { key: "week", title: "Next 7 days", tone: "", items: by((x) => !!x.due_date && x.due_date > t && x.due_date <= week) },
      { key: "later", title: "Later", tone: "", items: by((x) => !!x.due_date && x.due_date > week) },
      { key: "none", title: "No date", tone: "text-muted", items: by((x) => !x.due_date) },
    ].map((g) => ({ ...g, items: g.items.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")) }));
  }, [tasks]);

  const projectName = (id: string) => {
    const p = projects.find((x) => x.id === id);
    const w = workspaces.find((x) => x.id === p?.workspace_id);
    return p ? `${w?.name ?? ""} · ${p.name}` : "";
  };

  async function toggle(t: Task) {
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    await supabase().from("tasks").update({ done: !t.done }).eq("id", t.id);
  }

  const assignable = (projectId: string): Profile[] => {
    const p = projects.find((x) => x.id === projectId);
    return members
      .filter((m) => m.workspace_id === p?.workspace_id && m.role !== "guest")
      .map((m) => people.get(m.user_id))
      .filter((x): x is Profile => !!x);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">My tasks</h1>
        <div className="flex rounded-full border border-line bg-surface p-0.5 text-sm" role="tablist">
          {(
            [
              ["mine", "Assigned to me"],
              ["by_me", "Assigned by me"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`rounded-full px-3 py-1 ${view === k ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted">{tasks.length} open</span>
      </div>

      {workspaces.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm">
          <p className="font-medium">Welcome to SS Tasks 👋</p>
          <p className="mt-1 text-muted">Start with ＋ New workspace in the sidebar — one for each company (SSA, RMI, MBL, VISTA…).</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.key} className="space-y-2">
              <p className={`text-sm font-semibold ${g.tone}`}>
                {g.title} <span className="font-normal text-muted">{g.items.length}</span>
              </p>
              {g.items.map((t) => (
                <TaskCard key={t.id} task={t} projectName={projectName(t.project_id)} onOpen={() => setOpen(t)} onToggle={() => toggle(t)} />
              ))}
            </section>
          ))}
      </div>
      {tasks.length === 0 && workspaces.length > 0 && <p className="text-sm text-muted">Nothing open here. 🎉</p>}

      {open && (
        <TaskDrawer
          taskId={open.id}
          buckets={buckets}
          assignable={assignable(open.project_id)}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
