"use server";

import { GoogleNotConnected } from "@/lib/google";
import { MicrosoftNotConnected } from "@/lib/microsoft";
import { requireOwner } from "@/lib/supabase/server";
import { addGoogleSubtask, deleteGoogleTaskList, moveGoogleTask } from "@/lib/google-tasks";
import { forgetTask, REMIND_CHOICES, saveTaskSchedule, taskDoneChanged } from "@/lib/task-reminders";
import { addTask, createList, deleteTask, setTaskDone, todoProvider, updateTask } from "@/lib/todo";
import type { ListColor, NoteColor, TaskPriority, TodoList, TodoTaskEdit } from "@/lib/types";

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

/** Moves a task to another list; its dashboard colour, time and reminder follow it. */
export async function moveTodoTask(listId: string, taskId: string, toListId: string): Promise<TodoResult<{ id: string }>> {
  return attempt(async () => {
    if (!listId || !taskId || !toListId) throw new Error("Pick a list.");
    if (listId === toListId) return { id: taskId };
    const { supabase, provider: p } = await provider();
    if (p !== "google") throw new Error("Moving tasks works with Google Tasks.");
    const id = await moveGoogleTask(supabase, listId, taskId, toListId);
    if (id !== taskId) {
      await supabase.from("dashboard_task_colors").update({ task_id: id }).eq("task_id", taskId);
      await supabase.from("dashboard_task_times").update({ task_id: id }).eq("task_id", taskId);
      await supabase.from("dashboard_task_meta").update({ task_id: id }).eq("task_id", taskId);
    }
    return { id };
  });
}

/** Deletes a list and every task in it (Google Tasks); its dashboard colour goes too. */
export async function deleteTodoList(listId: string): Promise<TodoResult<void>> {
  return attempt(async () => {
    if (!listId) throw new Error("Unknown list.");
    const { supabase, provider: p } = await provider();
    if (p !== "google") throw new Error("Lists are deleted in Microsoft To Do itself.");
    await deleteGoogleTaskList(supabase, listId);
    await supabase.from("dashboard_list_colors").delete().eq("list_id", listId);
  });
}

/** Saves the order the lists show in (the panel and board); Google Tasks keeps no list order. */
export async function setTodoListOrder(listIds: string[]): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const ids = (Array.isArray(listIds) ? listIds : []).filter((x) => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, 100);
    const { error } = await supabase.from("dashboard_settings").upsert({ key: "task_list_order", value: ids });
    if (error) throw new Error(error.message);
  });
}

const PRIORITIES: TaskPriority[] = ["urgent", "important", "medium", "low"];

/** The dashboard's own priority for a task; null clears it. */
export async function setTodoTaskPriority(taskId: string, priority: TaskPriority | null): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    if (!taskId || taskId.length > 200) throw new Error("Unknown task.");
    if (priority && !PRIORITIES.includes(priority)) throw new Error("Unknown priority.");
    const { error } = priority
      ? await supabase.from("dashboard_task_meta").upsert({ task_id: taskId, priority })
      : await supabase.from("dashboard_task_meta").delete().eq("task_id", taskId);
    if (error) throw new Error(error.code === "42P01" || error.code === "PGRST205" ? "Priorities aren't set up yet." : error.message);
  });
}

/** Adds a checklist item (a Google subtask) to a task, after the last one. */
export async function addTodoSubtask(listId: string, parentId: string, title: string, after: string | null): Promise<TodoResult<void>> {
  return attempt(async () => {
    const clean = title.trim().slice(0, 255);
    if (!clean) throw new Error("Write the item first.");
    if (!listId || !parentId) throw new Error("Unknown task.");
    const { supabase, provider: p } = await provider();
    if (p !== "google") throw new Error("Checklists work with Google Tasks.");
    await addGoogleSubtask(supabase, listId, parentId, clean, after);
  });
}
