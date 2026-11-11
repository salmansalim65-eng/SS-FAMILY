import "server-only";
import { projectClient } from "@/lib/projects";

// SS's tasks from the SS Tasks app (its own Supabase), read through the
// key-guarded dashboard_tasks / dashboard_task_done functions
// (tasks/supabase/migrations/20261110120000_dashboard.sql).
// Needs SSTASKS_SUPABASE_URL, SSTASKS_SUPABASE_ANON_KEY and SSTASKS_DASHBOARD_KEY.

export const SSTASKS_URL = process.env.SSTASKS_APP_URL || "https://ss-family-tasks.vercel.app";

export type SsTask = {
  id: string;
  title: string;
  due: string | null;
  priority: "urgent" | "important" | "medium" | "low" | null;
  project_id: string;
  project: string;
  color: string | null;
  workspace: string;
  mine: boolean;
  by_me: boolean;
  assignees: string[];
  checks: number;
  checked: number;
};

const TIMEOUT_MS = 12_000;

function dashboardKey() {
  const key = process.env.SSTASKS_DASHBOARD_KEY;
  if (!key) throw new Error("SS Tasks is not connected yet (SSTASKS_DASHBOARD_KEY).");
  return key;
}

export async function loadSsTasks(): Promise<SsTask[]> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_tasks", { p_key: dashboardKey() })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return ((data as { tasks?: SsTask[] } | null)?.tasks ?? []).map((t) => ({
    ...t,
    checks: Number(t.checks) || 0,
    checked: Number(t.checked) || 0,
  }));
}

export async function setSsTaskDone(id: string, done: boolean) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_done", { p_key: dashboardKey(), p_task: id, p_done: done })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

export type SsProject = { id: string; name: string; color: string | null; workspace: string };

/** The owner's projects, for "add task". Empty when SS Tasks doesn't have dashboard_projects yet. */
export async function loadSsProjects(): Promise<SsProject[]> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_projects", { p_key: dashboardKey() })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) return [];
  return (data as SsProject[] | null) ?? [];
}

export async function createSsTask(project: string, title: string, due: string | null, priority: string | null): Promise<string> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_create", { p_key: dashboardKey(), p_project: project, p_title: title, p_due: due, p_priority: priority })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as string;
}
