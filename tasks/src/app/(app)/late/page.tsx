"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, useAppData } from "@/components/data";
import { daysLate, dmy, todayKey } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";
import type { Task } from "@/lib/types";

/**
 * Late tasks: open tasks whose due date has passed. Members see their own;
 * project owners see everyone's in their projects (Row Level Security).
 */
export default function LatePage() {
  const { projects, workspaces, people, loading } = useAppData();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    if (loading) return;
    const ids = projects.map((p) => p.id);
    if (!ids.length) return setTasks([]);
    supabase()
      .from("tasks")
      .select("*, task_assignees(user_id)")
      .in("project_id", ids)
      .eq("done", false)
      .lt("due_date", todayKey())
      .order("due_date")
      .then(({ data }) => setTasks((data ?? []) as Task[]));
  }, [loading, projects]);

  const project = (id: string) => projects.find((p) => p.id === id);
  const groups = workspaces
    .map((w) => ({ w, items: (tasks ?? []).filter((t) => project(t.project_id)?.workspace_id === w.id) }))
    .filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Late tasks</h1>
        <p className="text-sm text-muted">Open tasks past their due date. Alerts go out 1 day before, 1 day late and 7 days late.</p>
      </div>

      {tasks === null && <p className="text-sm text-muted">Loading…</p>}
      {tasks?.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-3xl">🎉</p>
          <p className="mt-1 font-medium">Nothing is late.</p>
        </div>
      )}

      {groups.map(({ w, items }) => (
        <section key={w.id} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-3 rounded" style={{ background: w.color }} aria-hidden />
            {w.name}
            <span className="rounded-full bg-red-100 px-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{items.length}</span>
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {items.map((t) => {
              const p = project(t.project_id);
              const late = daysLate(t.due_date!);
              const who = (t.task_assignees ?? []).map((a) => a.user_id);
              const doers = who.length ? who : [t.created_by];
              return (
                <li key={t.id}>
                  <Link href={`/p/${t.project_id}?task=${t.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2">
                    <span
                      className={`w-16 shrink-0 rounded-lg px-1.5 py-1 text-center text-xs font-semibold ${
                        late >= 7 ? "bg-red-600 text-white" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                      }`}
                    >
                      {late}d late
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span className="flex items-center gap-1">
                          <span className="size-2 rounded-full" style={{ background: p?.color }} aria-hidden />
                          {p?.name}
                        </span>
                        <span>due {dmy(t.due_date!)}</span>
                        {(t.postponed_count ?? 0) > 0 && <span className="text-amber-600 dark:text-amber-400">↪ moved {t.postponed_count}×</span>}
                      </span>
                    </span>
                    <span className="flex -space-x-2">
                      {doers.map((id) => (
                        <Avatar key={id} person={people.get(id)} size="xs" />
                      ))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
