import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasScope, TASKS_SCOPE } from "@/lib/google";
import { addGoogleTask, createGoogleTaskList, listGoogleTasks, setGoogleTaskDone } from "@/lib/google-tasks";
import { addTodo, listTodos, setTodoDone } from "@/lib/microsoft";

// The To Do panel's source: Google Tasks when the Google connection has the
// tasks scope, else Microsoft To Do when that is connected.

export type TodoProvider = "google" | "microsoft";

export async function todoProvider(db: SupabaseClient): Promise<{ provider: TodoProvider | null; googleNeedsReconnect: boolean }> {
  const { data, error } = await db.from("dashboard_oauth_tokens").select("provider, scope");
  if (error) throw new Error(error.message);
  const google = data?.find((r) => r.provider === "google");
  if (google && hasScope(google.scope, TASKS_SCOPE)) return { provider: "google", googleNeedsReconnect: false };
  if (data?.some((r) => r.provider === "microsoft")) return { provider: "microsoft", googleNeedsReconnect: false };
  return { provider: null, googleNeedsReconnect: Boolean(google) };
}

export function listTasks(db: SupabaseClient, provider: TodoProvider) {
  return provider === "google" ? listGoogleTasks(db) : listTodos(db);
}

export function addTask(db: SupabaseClient, provider: TodoProvider, listId: string, title: string, due: string | null) {
  return provider === "google" ? addGoogleTask(db, listId, title, due) : addTodo(db, listId, title, due);
}

export function setTaskDone(db: SupabaseClient, provider: TodoProvider, listId: string, taskId: string, done: boolean) {
  return provider === "google" ? setGoogleTaskDone(db, listId, taskId, done) : setTodoDone(db, listId, taskId, done);
}

export function createList(db: SupabaseClient, provider: TodoProvider, name: string) {
  if (provider !== "google") throw new Error("New lists can be made in Microsoft To Do itself.");
  return createGoogleTaskList(db, name);
}
