"use server";

import { addTodo, MicrosoftNotConnected, setTodoDone } from "@/lib/microsoft";
import { requireOwner } from "@/lib/supabase/server";

export type TodoResult = { ok: true } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function attempt(fn: () => Promise<void>): Promise<TodoResult> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof MicrosoftNotConnected) return { ok: false, error: "Reconnect Microsoft To Do in Settings." };
    return { ok: false, error: (e instanceof Error && e.message) || "Could not update Microsoft To Do. Please try again." };
  }
}

export async function addTodoTask(listId: string, title: string, due: string | null): Promise<TodoResult> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const clean = title.trim().slice(0, 255);
    if (!clean) throw new Error("Write the task first.");
    if (!listId) throw new Error("Pick a list.");
    if (due && !DATE.test(due)) throw new Error("That due date is not valid.");
    await addTodo(supabase, listId, clean, due || null);
  });
}

export async function setTodoTaskDone(listId: string, taskId: string, done: boolean): Promise<TodoResult> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    await setTodoDone(supabase, listId, taskId, done);
  });
}
