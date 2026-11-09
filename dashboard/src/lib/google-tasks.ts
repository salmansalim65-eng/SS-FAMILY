import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken, GoogleNotConnected } from "@/lib/google";
import type { TodoList, TodoTask, TodoTaskEdit } from "@/lib/types";

// Google Tasks for the To Do panel, through the same Google connection as
// the calendar (it needs the tasks scope, granted on Reconnect).

const API = "https://tasks.googleapis.com/tasks/v1";
const MAX_LISTS = 20;

async function call<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleNotConnected("Google rejected the access token");
  if (!res.ok) throw new Error(`Google Tasks error: ${json.error?.message ?? res.status}`);
  return json as T;
}

type GList = { id: string; title: string };
type GTask = { id: string; title?: string; notes?: string; status?: string; due?: string; updated?: string };

/** Every task list (the first is Google's default "My Tasks") and their open tasks. */
export async function listGoogleTasks(db: SupabaseClient): Promise<{ lists: TodoList[]; tasks: TodoTask[] }> {
  const token = await accessToken(db);
  const res = await call<{ items?: GList[] }>(token, "/users/@me/lists?maxResults=100");
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const lists = (res.items ?? []).slice(0, MAX_LISTS).map<TodoList>((l, i) => ({ id: l.id, name: l.title, isDefault: i === 0 }));

  const perList = await Promise.allSettled(
    lists.map(async (list) => {
      // Open tasks, and separately the ones completed in the last week (hidden
      // ones included: Google hides a completed task once it is cleared).
      const base = `/lists/${encodeURIComponent(list.id)}/tasks?maxResults=100`;
      const [open, finished] = await Promise.all([
        call<{ items?: GTask[] }>(token, `${base}&showCompleted=false`),
        call<{ items?: GTask[] }>(token, `${base}&showCompleted=true&showHidden=true&completedMin=${encodeURIComponent(weekAgo)}`),
      ]);
      const items = [...(open.items ?? []), ...(finished.items ?? []).filter((t) => t.status === "completed")];
      return items
        .filter((t) => t.title?.trim())
        .map<TodoTask>((t) => ({
          id: t.id,
          listId: list.id,
          listName: list.name,
          title: t.title!.trim(),
          important: false,
          // Google keeps due dates as midnight UTC of the chosen day.
          due: t.due ? t.due.slice(0, 10) : null,
          created: t.updated ?? null,
          notes: t.notes?.trim() || null,
          done: t.status === "completed",
        }));
    }),
  );
  if (lists.length > 0 && perList[0]?.status === "rejected") throw perList[0].reason;

  const tasks = perList
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (b.created ?? "").localeCompare(a.created ?? ""));
  return { lists, tasks };
}

/** Adds a task and returns its id. */
export async function addGoogleTask(db: SupabaseClient, listId: string, title: string, due: string | null): Promise<string | null> {
  const token = await accessToken(db);
  const created = await call<{ id?: string } | undefined>(token, `/lists/${encodeURIComponent(listId)}/tasks`, {
    method: "POST",
    body: { title, ...(due ? { due: `${due}T00:00:00.000Z` } : {}) },
  });
  return created?.id ?? null;
}

export async function setGoogleTaskDone(db: SupabaseClient, listId: string, taskId: string, done: boolean) {
  const token = await accessToken(db);
  await call(token, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: done ? { status: "completed" } : { status: "needsAction", completed: null },
  });
}

export async function updateGoogleTask(db: SupabaseClient, listId: string, taskId: string, edit: TodoTaskEdit) {
  const token = await accessToken(db);
  await call(token, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { title: edit.title, notes: edit.notes, due: edit.due ? `${edit.due}T00:00:00.000Z` : null },
  });
}

export async function deleteGoogleTask(db: SupabaseClient, listId: string, taskId: string) {
  const token = await accessToken(db);
  await call(token, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export async function createGoogleTaskList(db: SupabaseClient, title: string): Promise<TodoList> {
  const token = await accessToken(db);
  const l = await call<GList>(token, "/users/@me/lists", { method: "POST", body: { title } });
  return { id: l.id, name: l.title, isDefault: false };
}

/**
 * Moves a task to another list and returns its id there. Uses Google's move
 * with a destination list; where that isn't accepted, copies the task (title,
 * notes, due date, done state) into the other list and deletes the original.
 */
export async function moveGoogleTask(db: SupabaseClient, fromList: string, taskId: string, toList: string): Promise<string> {
  const token = await accessToken(db);
  const src = `/lists/${encodeURIComponent(fromList)}/tasks/${encodeURIComponent(taskId)}`;
  try {
    const moved = await call<GTask>(token, `${src}/move?destinationTasklist=${encodeURIComponent(toList)}`, { method: "POST" });
    if (moved?.id) return moved.id;
  } catch (e) {
    if (e instanceof GoogleNotConnected) throw e;
  }
  const t = await call<GTask>(token, src);
  const copy = await call<GTask>(token, `/lists/${encodeURIComponent(toList)}/tasks`, {
    method: "POST",
    body: { title: t.title ?? "", notes: t.notes, due: t.due, status: t.status ?? "needsAction" },
  });
  await call(token, src, { method: "DELETE" });
  return copy.id;
}

/** Deletes a whole task list with its tasks. Google keeps its default list. */
export async function deleteGoogleTaskList(db: SupabaseClient, listId: string) {
  const token = await accessToken(db);
  await call(token, `/users/@me/lists/${encodeURIComponent(listId)}`, { method: "DELETE" });
}
