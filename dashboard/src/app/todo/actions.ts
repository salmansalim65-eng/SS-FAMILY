"use server";

import { GoogleNotConnected } from "@/lib/google";
import { MicrosoftNotConnected } from "@/lib/microsoft";
import { requireOwner } from "@/lib/supabase/server";
import { importGoogleTasks } from "@/lib/google-tasks";
import { IMPORT_MAX_TASKS, importCount, parseTaskImport } from "@/lib/task-import";
import { forgetTask, REMIND_CHOICES, saveTaskSchedule, taskDoneChanged } from "@/lib/task-reminders";
import { addTask, createList, deleteTask, setTaskDone, todoProvider, updateTask } from "@/lib/todo";
import type { ListColor, NoteColor, TodoList, TodoTaskEdit } from "@/lib/types";

const COLORS: NoteColor[] = ["yellow", "pink", "green", "blue", "purple", "orange"];

export type TodoResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function checkRemind(remind: number | null | undefined, time: string | null) {
  if (remind === null || remind === undefined) return null;
  if (!time) throw new Error("Set a time for the reminder.");
  if (!(REMIND_CHOICES as readonly number[]).includes(remind)) throw new Error("That reminder is not valid.");
  return remind;
}


async function attempt<T>(fn: () => Promise<T>): Promise<TodoResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof GoogleNotConnected || e instanceof MicrosoftNotConnected) {
      return { ok: false, error: "Reconnect Google in Settings to use tasks." };
    }
    return { ok: false, error: (e instanceof Error && e.message) || "Could not update your tasks. Please try again." };
  }
}

async function provider() {
  const { supabase } = await requireOwner();
  const { provider } = await todoProvider(supabase);
  if (!provider) throw new GoogleNotConnected("No task service connected");
  return { supabase, provider };
}

export async function addTodoTask(
  listId: string,
  title: string,
  due: string | null,
  time: string | null = null,
  remind: number | null = null,
): Promise<TodoResult<void>> {
  return attempt(async () => {
    const clean = title.trim().slice(0, 255);
    if (!clean) throw new Error("Write the task first.");
    if (!listId) throw new Error("Pick a list.");
    if (due && !DATE.test(due)) throw new Error("That due date is not valid.");
    if (time && (!due || !TIME.test(time))) throw new Error(due ? "That time is not valid." : "Pick a due date for the time.");
    const reminder = checkRemind(remind, time);
    const { supabase, provider: p } = await provider();
    const id = await addTask(supabase, p, listId, clean, due || null);
    if (time && id) await saveTaskSchedule(supabase, id, { title: clean, due, time, remind: reminder });
  });
}

export async function setTodoTaskDone(
  listId: string,
  taskId: string,
  done: boolean,
  task?: { title: string; due: string | null },
): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase, provider: p } = await provider();
    await setTaskDone(supabase, p, listId, taskId, done);
    // The tick has happened; a reminder that can't follow it is not worth an error.
    if (task) await taskDoneChanged(supabase, taskId, done, task.title.slice(0, 255), task.due && DATE.test(task.due) ? task.due : null).catch(() => {});
  });
}

export async function updateTodoTask(listId: string, taskId: string, edit: TodoTaskEdit): Promise<TodoResult<void>> {
  return attempt(async () => {
    const title = edit.title.trim().slice(0, 255);
    if (!title) throw new Error("A task needs a title.");
    if (edit.due && !DATE.test(edit.due)) throw new Error("That due date is not valid.");
    const time = edit.due && edit.time ? edit.time : null;
    if (time && !TIME.test(time)) throw new Error("That time is not valid.");
    const remind = checkRemind(edit.remind, time);
    const { supabase, provider: p } = await provider();
    await updateTask(supabase, p, listId, taskId, { title, notes: edit.notes.slice(0, 8000), due: edit.due || null });
    await saveTaskSchedule(supabase, taskId, { title, due: edit.due || null, time, remind });
  });
}

export async function deleteTodoTask(listId: string, taskId: string): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase, provider: p } = await provider();
    await deleteTask(supabase, p, listId, taskId);
    await forgetTask(supabase, taskId);
  });
}

/** The dashboard's own colour for a task; null clears it. */
export async function setTodoTaskColor(taskId: string, color: NoteColor | null): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    if (!taskId || taskId.length > 200) throw new Error("Unknown task.");
    if (color && !COLORS.includes(color)) throw new Error("Unknown colour.");
    const { error } = color
      ? await supabase.from("dashboard_task_colors").upsert({ task_id: taskId, color })
      : await supabase.from("dashboard_task_colors").delete().eq("task_id", taskId);
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Task colours aren't set up yet." : error.message);
  });
}

export async function createTodoList(name: string): Promise<TodoResult<TodoList>> {
  return attempt(async () => {
    const clean = name.trim().slice(0, 100);
    if (!clean) throw new Error("Name the list first.");
    const { supabase, provider: p } = await provider();
    return createList(supabase, p, clean);
  });
}

const LIST_COLORS: ListColor[] = ["blue", "purple", "green", "yellow", "pink", "teal", "orange", "gray", "indigo", "red"];

/** The dashboard's own colour for a list's heading; null goes back to the automatic one. */
export async function setTodoListColor(listId: string, color: ListColor | null): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    if (!listId || listId.length > 200) throw new Error("Unknown list.");
    if (color && !LIST_COLORS.includes(color)) throw new Error("Unknown colour.");
    const { error } = color
      ? await supabase.from("dashboard_list_colors").upsert({ list_id: listId, color })
      : await supabase.from("dashboard_list_colors").delete().eq("list_id", listId);
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "List colours aren't set up yet." : error.message);
  });
}

/** Pasted lists and tasks into Google Tasks; missing lists are made. */
export async function importTodoTasks(text: string): Promise<TodoResult<{ added: number; createdLists: string[] }>> {
  return attempt(async () => {
    const groups = parseTaskImport(String(text ?? "").slice(0, 100_000));
    const count = importCount(groups);
    if (count === 0) throw new Error("Nothing to import — paste one task per line.");
    if (count > IMPORT_MAX_TASKS) throw new Error(`That's ${count} tasks; import up to ${IMPORT_MAX_TASKS} at a time.`);
    const { supabase, provider: p } = await provider();
    if (p !== "google") throw new Error("Import works with Google Tasks — connect Google first.");
    return importGoogleTasks(supabase, groups);
  });
}
