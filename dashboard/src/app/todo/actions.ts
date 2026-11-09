"use server";

import { GoogleNotConnected } from "@/lib/google";
import { MicrosoftNotConnected } from "@/lib/microsoft";
import { requireOwner } from "@/lib/supabase/server";
import { addTask, createList, setTaskDone, todoProvider } from "@/lib/todo";
import type { TodoList } from "@/lib/types";

export type TodoResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

export async function addTodoTask(listId: string, title: string, due: string | null): Promise<TodoResult<void>> {
  return attempt(async () => {
    const clean = title.trim().slice(0, 255);
    if (!clean) throw new Error("Write the task first.");
    if (!listId) throw new Error("Pick a list.");
    if (due && !DATE.test(due)) throw new Error("That due date is not valid.");
    const { supabase, provider: p } = await provider();
    await addTask(supabase, p, listId, clean, due || null);
  });
}

export async function setTodoTaskDone(listId: string, taskId: string, done: boolean): Promise<TodoResult<void>> {
  return attempt(async () => {
    const { supabase, provider: p } = await provider();
    await setTaskDone(supabase, p, listId, taskId, done);
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
