"use server";

import { GoogleNotConnected } from "@/lib/google";
import { MicrosoftNotConnected } from "@/lib/microsoft";
import { requireOwner } from "@/lib/supabase/server";
import { addTask, createList, deleteTask, setTaskDone, todoProvider, updateTask } from "@/lib/todo";
import type { NoteColor, TodoList, TodoTaskEdit } from "@/lib/types";

const COLORS: NoteColor[] = ["yellow", "pink", "green", "blue", "purple", "orange"];

export type TodoResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Google Tasks keeps only a due date, so the time is the dashboard's own,
 * kept by task id (null clears it). A missing table just means no times.
 */
async function saveTime(db: Awaited<ReturnType<typeof requireOwner>>["supabase"], taskId: string, time: string | null) {
  const { error } = time
    ? await db.from("dashboard_task_times").upsert({ task_id: taskId, due_time: time })
    : await db.from("dashboard_task_times").delete().eq("task_id", taskId);
  if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Task times aren't set up yet." : error.message);
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

export async function addTodoTask(listId: string, title: string, due: string | null, time: string | null = null): Promise<TodoResult<void>> {
  return attempt(async () => {
    const clean = title.trim().slice(0, 255);
    if (!clean) throw new Error("Write the task first.");
    if (!listId) throw new Error("Pick a list.");
    if (due && !DATE.test(due)) throw new Error("That due date is not valid.");
    if (time && (!due || !TIME.test(time))) throw new Error(due ? "That time is not valid." : "Pick a due date for the time.");
    const { supabase, provider: p } = await provider();
    const id = await addTask(supabase, p, listId, clean, due || null);
    if (time && id) await saveTime(supabase, id, time);
  });
}

export async function setTodoTaskDone(listId: string, taskId: string, done: boolean): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase, provider: p } = await provider();
    await setTaskDone(supabase, p, listId, taskId, done);
  });
}

export async function updateTodoTask(listId: string, taskId: string, edit: TodoTaskEdit): Promise<TodoResult<void>> {
  return attempt(async () => {
    const title = edit.title.trim().slice(0, 255);
    if (!title) throw new Error("A task needs a title.");
    if (edit.due && !DATE.test(edit.due)) throw new Error("That due date is not valid.");
    const time = edit.due && edit.time ? edit.time : null;
    if (time && !TIME.test(time)) throw new Error("That time is not valid.");
    const { supabase, provider: p } = await provider();
    await updateTask(supabase, p, listId, taskId, { title, notes: edit.notes.slice(0, 8000), due: edit.due || null });
    if (time || edit.time !== undefined) await saveTime(supabase, taskId, time);
  });
}

export async function deleteTodoTask(listId: string, taskId: string): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase, provider: p } = await provider();
    await deleteTask(supabase, p, listId, taskId);
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
