"use client";

import { dueLabel } from "@/lib/dates";
import { PRIORITIES, type Task } from "@/lib/types";
import { Avatar, useAppData } from "./data";

// The task being dragged (HTML drag and drop carries only text).
export const drag: { task: Task | null } = { task: null };

/** A task on the board or in a list: title, priority, due date, checklist count and assignees. */
export function TaskCard({ task, onOpen, onToggle, projectName }: { task: Task; onOpen: () => void; onToggle: () => void; projectName?: string }) {
  const { people } = useAppData();
  const pri = PRIORITIES.find((p) => p.key === task.priority);
  const checks = task.checklist_items ?? [];
  const done = checks.filter((c) => c.done).length;
  const due = task.due_date ? dueLabel(task.due_date, task.done) : null;
  return (
    <div
      draggable
      onDragStart={(e) => {
        drag.task = task;
        e.dataTransfer.setData("text/plain", task.title);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (drag.task = null)}
      className="group cursor-grab rounded-xl border border-line bg-surface p-2.5 shadow-sm hover:shadow active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={task.done}
          onChange={onToggle}
          aria-label={task.done ? "Mark not done" : "Mark done"}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-emerald-600"
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className={`block text-sm ${task.done ? "text-muted line-through" : ""}`} dir="auto">
            {task.title}
          </span>
        </button>
      </div>
      {(pri || due || checks.length > 0 || projectName || (task.task_assignees?.length ?? 0) > 0) && (
        <button type="button" onClick={onOpen} className="mt-1.5 flex w-full flex-wrap items-center gap-1.5 pl-6 text-[11px] text-muted">
          {pri && !task.done && <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${pri.chip}`}>{pri.label}</span>}
          {due && <span className={`${due.tone} ${due.late ? "font-medium" : ""}`}>📅 {due.text}</span>}
          {checks.length > 0 && (
            <span className={done === checks.length ? "text-emerald-600 dark:text-emerald-400" : ""}>
              ☑ {done}/{checks.length}
            </span>
          )}
          {projectName && <span className="truncate">{projectName}</span>}
          <span className="ml-auto flex -space-x-1.5">
            {(task.task_assignees ?? []).slice(0, 4).map((a) => (
              <Avatar key={a.user_id} person={people.get(a.user_id)} size="xs" />
            ))}
          </span>
        </button>
      )}
    </div>
  );
}

export const TASK_SELECT = "*, task_assignees(user_id), checklist_items(id, done)";
