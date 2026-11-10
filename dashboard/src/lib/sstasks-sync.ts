import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken, GoogleNotConnected } from "@/lib/google";
import { projectClient } from "@/lib/projects";

// Two-way sync between SS's tasks in SS Tasks and SS's Google Tasks.
//  - Every Google list is a project in SS Tasks' "Personal" workspace; its
//    open tasks are copied in once (subtasks become the checklist, the
//    dashboard's priority comes along) and kept in step after that.
//  - SS's tasks from every other project go to the Google list "SS Tasks";
//    a task added to that list in Google lands in Personal › Inbox.
//  - Done, title, due date and notes follow whichever side changed last.
// Runs from the dashboard (it holds the Google connection), at most once a
// minute, through SS Tasks' key-guarded dashboard_sync_* functions.

const API = "https://tasks.googleapis.com/tasks/v1";
const INBOX_TITLE = "SS Tasks";
const MAX_LISTS = 20;
const PARALLEL = 5;

type GList = { id: string; title: string };
type GTask = {
  id: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  updated?: string;
  parent?: string;
  position?: string;
  deleted?: boolean;
};
type Link = { google_list: string; google_task: string; done: boolean; gone: boolean; synced_at: string };
type SsTask = {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  done: boolean;
  updated_at: string;
  project_id: string;
  link: Link | null;
};
type State = {
  settings: { workspace_id: string | null; inbox_list: string | null; inbox_project: string | null } | null;
  lists: { google_list: string; project_id: string }[];
  tasks: SsTask[];
  orphans: (Link & { task_id: string })[];
  linked: string[];
};
type Op = Record<string, unknown> & { op: string };

export type SyncResult = { ran: boolean; created: number; updated: number; pushed: number; errors: string[] };

class NotFound extends Error {}

async function g<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleNotConnected("Google rejected the access token");
  if (res.status === 404) throw new NotFound("Not found in Google");
  if (!res.ok) throw new Error(`Google Tasks error: ${json.error?.message ?? res.status}`);
  return json as T;
}

async function allTasks(token: string, listId: string): Promise<GTask[]> {
  const out: GTask[] = [];
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true", showDeleted: "true" });
    if (page) q.set("pageToken", page);
    const res = await g<{ items?: GTask[]; nextPageToken?: string }>(token, `/lists/${encodeURIComponent(listId)}/tasks?${q}`);
    out.push(...(res.items ?? []));
    page = res.nextPageToken;
    if (!page) break;
  }
  return out;
}

/** Runs fn over items, a few at a time. */
async function each<T>(items: T[], fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += PARALLEL) await Promise.all(items.slice(i, i + PARALLEL).map(fn));
}

const gDue = (t: GTask) => (t.due ? t.due.slice(0, 10) : null);
const gDone = (t: GTask) => t.status === "completed";
const clean = (s: string | null | undefined) => (s ?? "").trim();
const body = (t: { title: string; notes: string; due: string | null }) => ({
  title: t.title,
  notes: t.notes || null,
  due: t.due ? `${t.due}T00:00:00.000Z` : null,
});

function dashboardKey() {
  const key = process.env.SSTASKS_DASHBOARD_KEY;
  if (!key) throw new Error("SS Tasks is not connected yet (SSTASKS_DASHBOARD_KEY).");
  return key;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc(fn, { p_key: dashboardKey(), ...args })
    .abortSignal(AbortSignal.timeout(20_000));
  if (error) throw new Error(error.message);
  return data as T;
}

async function apply(ops: Op[], errors: string[]) {
  const out: { id?: string | null; error?: string }[] = [];
  for (let i = 0; i < ops.length; i += 200) {
    const res = await rpc<{ id?: string | null; error?: string }[]>("dashboard_sync_apply", { p_ops: ops.slice(i, i + 200) });
    out.push(...res);
  }
  for (const r of out) if (r.error) errors.push(r.error);
  return out;
}

/**
 * One sync pass. `db` is the dashboard's own Supabase (for the Google token
 * and the dashboard's task priorities). Skips quietly when Google or SS Tasks
 * isn't connected, or when another pass ran in the last `minSeconds`.
 */
export async function syncSsTasksWithGoogle(db: SupabaseClient, minSeconds = 60): Promise<SyncResult> {
  const result: SyncResult = { ran: false, created: 0, updated: 0, pushed: 0, errors: [] };
  if (!process.env.SSTASKS_DASHBOARD_KEY || !process.env.SSTASKS_SUPABASE_URL) return result;

  let token: string;
  try {
    token = await accessToken(db);
  } catch {
    return result; // Google not connected
  }
  if (!(await rpc<boolean>("dashboard_sync_claim", { p_seconds: minSeconds }))) return result;
  result.ran = true;

  // 1. Lists: the "SS Tasks" inbox list, and every other Google list mapped to a Personal project.
  let state = await rpc<State>("dashboard_sync_state", {});
  const gLists = ((await g<{ items?: GList[] }>(token, "/users/@me/lists?maxResults=100")).items ?? []).slice(0, MAX_LISTS + 1);
  const setupOps: Op[] = [];
  let inbox = gLists.find((l) => l.id === state.settings?.inbox_list) ?? gLists.find((l) => l.title === INBOX_TITLE);
  if (!inbox) inbox = await g<GList>(token, "/users/@me/lists", { method: "POST", body: { title: INBOX_TITLE } });
  if (state.settings?.inbox_list !== inbox.id || !state.lists.some((l) => l.google_list === inbox!.id)) {
    setupOps.push({ op: "inbox", google_list: inbox.id });
  }
  const mapped = new Set(state.lists.map((l) => l.google_list));
  for (const l of gLists) if (l.id !== inbox.id && !mapped.has(l.id)) setupOps.push({ op: "map_list", google_list: l.id, title: l.title });
  if (setupOps.length) {
    await apply(setupOps, result.errors);
    state = await rpc<State>("dashboard_sync_state", {});
  }
  const inboxId = inbox.id;
  const listOfProject = new Map(state.lists.map((l) => [l.project_id, l.google_list]));
  const liveLists = new Set(gLists.map((l) => l.id));

  // 2. Every task of the mapped lists that still exist in Google.
  const gTasks = new Map<string, GTask & { list: string }>();
  const byList = new Map<string, GTask[]>();
  await each(
    state.lists.filter((l) => liveLists.has(l.google_list)),
    async (l) => {
      const items = await allTasks(token, l.google_list);
      byList.set(l.google_list, items);
      for (const t of items) gTasks.set(t.id, { ...t, list: l.google_list });
    },
  );

  const ops: Op[] = [];

  // 3. SS Tasks → Google, and changes made in Google on linked tasks.
  await each(state.tasks, async (t) => {
    try {
      const link = t.link;
      if (!link) {
        if (t.done) return;
        const list = listOfProject.get(t.project_id) ?? inboxId;
        const created = await g<GTask>(token, `/lists/${encodeURIComponent(list)}/tasks`, { method: "POST", body: body(t) });
        ops.push({ op: "link", task_id: t.id, google_list: list, google_task: created.id, done: false });
        result.pushed++;
        return;
      }
      if (link.gone) return;
      const gt = gTasks.get(link.google_task);
      if (!liveLists.has(link.google_list) || !gt || gt.deleted) {
        // Deleted in Google (or its list was): leave the SS task alone and stop copying it.
        ops.push({ op: "gone", task_id: t.id });
        return;
      }
      const synced = new Date(link.synced_at).getTime();
      const ssChanged = new Date(t.updated_at).getTime() > synced + 1000;
      const gChanged = new Date(gt.updated ?? 0).getTime() > synced + 1000;

      let done = t.done;
      const fix: Op = { op: "update", task_id: t.id };
      const patch: Record<string, unknown> = {};

      // Done: whichever side moved away from the last synced state (SS wins a tie).
      if (t.done !== link.done) patch.status = t.done ? "completed" : "needsAction";
      else if (gDone(gt) !== link.done) {
        fix.done = gDone(gt);
        done = gDone(gt);
      }
      if (patch.status === "needsAction") patch.completed = null;

      // Title, due date and notes: from Google when only Google changed, else from SS.
      const differs =
        clean(gt.title) !== clean(t.title) || gDue(gt) !== t.due || clean(gt.notes) !== clean(t.notes);
      if (differs) {
        if (gChanged && !ssChanged) {
          if (clean(gt.title)) fix.title = clean(gt.title);
          fix.due = gDue(gt);
          fix.notes = clean(gt.notes);
        } else {
          Object.assign(patch, body(t));
        }
      }

      if (Object.keys(patch).length) {
        await g(token, `/lists/${encodeURIComponent(link.google_list)}/tasks/${encodeURIComponent(link.google_task)}`, {
          method: "PATCH",
          body: patch,
        });
        result.pushed++;
      }
      if (Object.keys(fix).length > 2) {
        ops.push(fix);
        result.updated++;
      }
      if (Object.keys(patch).length || Object.keys(fix).length > 2 || done !== link.done) {
        ops.push({ op: "link", task_id: t.id, google_list: link.google_list, google_task: link.google_task, done });
      }
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  });

  // 4. Tasks gone from SS (deleted, unassigned, project archived): remove their Google copy.
  await each(state.orphans, async (o) => {
    try {
      await g(token, `/lists/${encodeURIComponent(o.google_list)}/tasks/${encodeURIComponent(o.google_task)}`, { method: "DELETE" });
    } catch (e) {
      if (!(e instanceof NotFound)) return void result.errors.push(e instanceof Error ? e.message : String(e));
    }
    ops.push({ op: "unlink", task_id: o.task_id });
  });

  // 5. Google → SS Tasks: open tasks in mapped lists that aren't linked yet.
  const linked = new Set(state.linked);
  const priority = new Map<string, string>();
  const { data: meta } = await db.from("dashboard_task_meta").select("task_id, priority");
  for (const m of meta ?? []) if (m.priority) priority.set(m.task_id as string, m.priority as string);
  for (const [list, items] of byList) {
    const subtasks = new Map<string, GTask[]>();
    for (const t of items) if (t.parent && !t.deleted) subtasks.set(t.parent, [...(subtasks.get(t.parent) ?? []), t]);
    for (const t of items) {
      if (t.parent || t.deleted || gDone(t) || !clean(t.title) || linked.has(t.id)) continue;
      ops.push({
        op: "create",
        google_list: list,
        google_task: t.id,
        title: clean(t.title),
        notes: clean(t.notes),
        due: gDue(t),
        done: false,
        priority: priority.get(t.id) ?? null,
        checklist: (subtasks.get(t.id) ?? [])
          .sort((a, b) => (a.position ?? "").localeCompare(b.position ?? ""))
          .map((s) => ({ title: clean(s.title), done: gDone(s) })),
      });
      result.created++;
    }
  }

  if (ops.length) await apply(ops, result.errors);
  return result;
}
