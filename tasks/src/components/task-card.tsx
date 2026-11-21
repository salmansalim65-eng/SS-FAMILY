"use client";

import { dueLabel } from "@/lib/dates";
import { PRIORITIES, type Task } from "@/lib/types";
import { Avatar, useAppData } from "./data";

// The task being dragged (HTML drag and drop carries only text).
export const drag: { task: Task | null } = { task: null };

/** A task on the board or in a list, as on the SS Dashboard: round tick, title, due date, priority, checklist and assignees. */
export function TaskCard({
  task,
  onOpen,
  onToggle,
  projectName,
  color,
}: {
  task: Task;
  onOpen: () => void;
  onToggle: () => void;
  projectName?: string;
  /** The column's colour, as a stripe down the left. */
  color?: string;
}) {
  const { people } = useAppData();
  const pri = PRIORITIES.find((p) => p.key === task.priority);
  const checks = task.checklist_items ?? [];
  const done = checks.filter((c) => c.done).length;
  const due = task.due_date ? dueLabel(task.due_date, task.done) : null;
  const assignees = task.task_assignees ?? [];
  return (
    <div
      draggable
      onDragStart={(e) => {
        drag.task = task;
        e.dataTransfer.setData("text/plain", task.title);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => (drag.task = null)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input")) onOpen();
      }}
      style={{ borderLeft: `4px solid ${task.done ? "#94a3b8" : (color ?? "var(--line)")}` }}
      className="group flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface p-2.5 shadow-sm transition hover:-translate-y-px hover:shadow-md active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={task.done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] transition ${
          task.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-line text-transparent hover:border-emerald-500 hover:text-emerald-600"
        }`}
      >
        ✓
      </button>
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-3 text-sm font-medium ${task.done ? "text-muted line-through" : ""}`} dir="auto">
          {task.title}
        </span>
        {(pri || due || checks.length > 0 || projectName || assignees.length > 0) && (
          <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            {due && (
              <span className={`rounded-full px-1.5 py-0.5 ${due.late ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200" : due.text === "Today" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-surface-2"}`}>
                {due.late ? "⚠ " : "📅 "}
                {due.text}
              </span>
            )}
            {pri && !task.done && pri.key !== "medium" && <span className={`rounded-full px-1.5 py-0.5 ${pri.chip}`}>{pri.label}</span>}
            {checks.length > 0 && (
              <span className={done === checks.length ? "text-emerald-600 dark:text-emerald-400" : ""}>
                ☑ {done}/{checks.length}
              </span>
            )}
            {projectName && <span className="truncate">{projectName}</span>}
            {assignees.length > 0 && (
              <span className="ml-auto flex -space-x-1.5">
                {assignees.slice(0, 4).map((a) => (
                  <Avatar key={a.user_id} person={people.get(a.user_id)} size="xs" />
                ))}
                {assignees.length > 4 && <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[9px]">+{assignees.length - 4}</span>}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export const TASK_SELECT = "*, task_assignees(user_id), checklist_items(id, done)";
