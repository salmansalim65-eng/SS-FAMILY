import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken, GoogleNotConnected } from "@/lib/google";
import type { TodoList, TodoTask } from "@/lib/types";

// Google Tasks for the To Do panel, through the same Google connection as
// the calendar (it needs the tasks scope, granted on Reconnect).

const API = "https://tasks.googleapis.com/tasks/v1";
const MAX_LISTS = 10;

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
type GTask = { id: string; title?: string; status?: string; due?: string; updated?: string };

/** Every task list (the first is Google's default "My Tasks") and their open tasks. */
export async function listGoogleTasks(db: SupabaseClient): Promise<{ lists: TodoList[]; tasks: TodoTask[] }> {
  const token = await accessToken(db);
  const res = await call<{ items?: GList[] }>(token, "/users/@me/lists?maxResults=100");
  const lists = (res.items ?? []).slice(0, MAX_LISTS).map<TodoList>((l, i) => ({ id: l.id, name: l.title, isDefault: i === 0 }));

  const perList = await Promise.allSettled(
    lists.map(async (list) => {
      const r = await call<{ items?: GTask[] }>(
        token,
        `/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=false&maxResults=100`,
      );
      return (r.items ?? [])
        .filter((t) => t.status !== "completed" && t.title?.trim())
        .map<TodoTask>((t) => ({
          id: t.id,
          listId: list.id,
          listName: list.name,
          title: t.title!.trim(),
          important: false,
          // Google keeps due dates as midnight UTC of the chosen day.
          due: t.due ? t.due.slice(0, 10) : null,
          created: t.updated ?? null,
        }));
    }),
  );
  if (lists.length > 0 && perList[0]?.status === "rejected") throw perList[0].reason;

  const tasks = perList
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (b.created ?? "").localeCompare(a.created ?? ""));
  return { lists, tasks };
}

export async function addGoogleTask(db: SupabaseClient, listId: string, title: string, due: string | null) {
  const token = await accessToken(db);
  await call(token, `/lists/${encodeURIComponent(listId)}/tasks`, {
    method: "POST",
    body: { title, ...(due ? { due: `${due}T00:00:00.000Z` } : {}) },
  });
}

export async function setGoogleTaskDone(db: SupabaseClient, listId: string, taskId: string, done: boolean) {
  const token = await accessToken(db);
  await call(token, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: done ? { status: "completed" } : { status: "needsAction", completed: null },
  });
}

export async function createGoogleTaskList(db: SupabaseClient, title: string): Promise<TodoList> {
  const token = await accessToken(db);
  const l = await call<GList>(token, "/users/@me/lists", { method: "POST", body: { title } });
  return { id: l.id, name: l.title, isDefault: false };
}
