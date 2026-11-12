import "server-only";
import { projectClient } from "@/lib/projects";

// SS's tasks from the Task Hub app (its own Supabase), read through the
// key-guarded dashboard_tasks / dashboard_task_done functions
// (tasks/supabase/migrations/20261110120000_dashboard.sql).
// Needs SSTASKS_SUPABASE_URL, SSTASKS_SUPABASE_ANON_KEY and SSTASKS_DASHBOARD_KEY.

export const SSTASKS_URL = process.env.SSTASKS_APP_URL || "https://ss-family-tasks.vercel.app";

export type SsTask = {
  id: string;
  title: string;
  due: string | null;
  time?: string | null; // HH:MM on the due date, if set
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
  bucket: string | null;
  assignee_ids?: string[];
};

const TIMEOUT_MS = 12_000;

function dashboardKey() {
  const key = process.env.SSTASKS_DASHBOARD_KEY;
  if (!key) throw new Error("Task Hub is not connected yet (SSTASKS_DASHBOARD_KEY).");
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

export type SsProject = { id: string; name: string; color: string | null; workspace: string; people?: { id: string; name: string }[] };

/** The owner's projects, for "add task". Empty when Task Hub doesn't have dashboard_projects yet. */
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

export type SsTaskPatch = { title?: string; due?: string | null; time?: string | null; priority?: string | null; project?: string; bucket?: string };

/** Moves or edits a task (due date, priority, project, column), as SS. */
export async function updateSsTask(id: string, patch: SsTaskPatch) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_update", { p_key: dashboardKey(), p_task: id, p_patch: patch })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

export type SsTaskDetail = {
  id: string;
  title: string;
  notes: string;
  start: string | null;
  due: string | null;
  time?: string | null;
  priority: string | null;
  done: boolean;
  project_id: string;
  bucket_id: string | null;
  buckets: { id: string; name: string }[];
  people: { id: string; name: string; email: string }[];
  assignee_ids: string[];
  checklist: { id: string; title: string; done: boolean }[];
  comments: { id: string; body: string; created_at: string; mine: boolean; name: string }[];
  attachments?: { id: string; name: string; size: number | null; created_at: string }[];
  can_delete: boolean;
};
export type SsTaskOp =
  | { op: "set"; title?: string; notes?: string; start?: string; due?: string; time?: string; priority?: string; bucket?: string; done?: boolean }
  | { op: "check_add"; title: string }
  | { op: "check_toggle"; id: string }
  | { op: "check_delete"; id: string }
  | { op: "comment"; body: string };

/** Everything the task panel shows, as SS. */
export async function getSsTaskDetail(id: string): Promise<SsTaskDetail> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_detail", { p_key: dashboardKey(), p_task: id })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as SsTaskDetail;
}

/** One change from the task panel (fields, checklist, comment), as SS. */
export async function applySsTask(id: string, op: SsTaskOp) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_apply", { p_key: dashboardKey(), p_task: id, p_op: op })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

/** Deletes a task for good, as SS. */
export async function deleteSsTask(id: string) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_delete", { p_key: dashboardKey(), p_task: id })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

/** Deletes a project and all its tasks, as SS (Google Tasks lists are refused). */
export async function deleteSsProject(id: string) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_project_delete", { p_key: dashboardKey(), p_project: id })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

/** Gives a task to someone on its project, or takes it back, as SS. */
export async function assignSsTask(id: string, user: string, on: boolean) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_assign", { p_key: dashboardKey(), p_task: id, p_user: user, p_on: on })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

export type AssignByEmailResult = { status: "assigned"; name: string; added?: boolean } | { status: "invited"; email: string; token: string };

/** Assigns by email: someone in Task Hub gets it now; anyone else gets a project invite and the task waits for them. */
export async function assignSsTaskByEmail(id: string, email: string): Promise<AssignByEmailResult> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_task_assign_email", { p_key: dashboardKey(), p_task: id, p_email: email })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as AssignByEmailResult;
}

export type SsWorkspace = { id: string; name: string; color: string | null };

export async function loadSsWorkspaces(): Promise<SsWorkspace[]> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_workspaces", { p_key: dashboardKey() })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) return [];
  return (data as SsWorkspace[] | null) ?? [];
}

export async function createSsProject(workspace: string, name: string, color: string): Promise<string> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_project_create", { p_key: dashboardKey(), p_workspace: workspace, p_name: name, p_color: color })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as string;
}

export type ShareResult = { status: "added"; name: string } | { status: "invited"; email: string; token: string };

/** Shares a project by email: adds someone already in Task Hub, or makes an invite link for anyone else. */
export async function shareSsProject(project: string, email: string): Promise<ShareResult> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_project_share", { p_key: dashboardKey(), p_project: project, p_email: email })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as ShareResult;
}

export type SsProjectMembers = {
  can_manage: boolean;
  me: string;
  members: { id: string; name: string; email: string; role: "owner" | "member"; guest: boolean }[];
  invites?: { token: string; email: string; created_at: string }[];
  candidates: { id: string; name: string }[];
};

/** Who is in a project, and the workspace people who could be added. */
export async function getSsProjectMembers(project: string): Promise<SsProjectMembers> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_project_members", { p_key: dashboardKey(), p_project: project })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as SsProjectMembers;
}

export type SsMemberAction = "add" | "remove" | "owner" | "member";

/** Adds a workspace person to a project, removes them, or changes their role (project owners only). */
export async function setSsProjectMember(project: string, user: string, action: SsMemberAction) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_project_member_set", { p_key: dashboardKey(), p_project: project, p_user: user, p_action: action })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

export type SsBoardTask = {
  id: string;
  title: string;
  bucket_id: string | null;
  done: boolean;
  due: string | null;
  time: string | null;
  priority: SsTask["priority"];
  assignees: string[];
  checks: number;
  checked: number;
};
export type SsProjectBoard = {
  project: { id: string; name: string; color: string | null; workspace: string };
  can_manage: boolean;
  buckets: { id: string; name: string }[];
  tasks: SsBoardTask[];
};

/** A whole project as a Planner-style board: its columns and every task the owner may see in it. */
export async function getSsProjectBoard(project: string): Promise<SsProjectBoard> {
  const { data, error } = await projectClient("SSTASKS")
    .rpc("dashboard_project_board", { p_key: dashboardKey(), p_project: project })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return data as SsProjectBoard;
}

export type SsBucketAction = "add" | "rename" | "left" | "right" | "delete";

/** Adds, renames, moves or deletes (when empty) a column of a project (project owners only). */
export async function editSsBucket(project: string, action: SsBucketAction, bucket: string | null, name: string | null) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_bucket_edit", { p_key: dashboardKey(), p_project: project, p_action: action, p_bucket: bucket, p_name: name })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}

/** Cancels an invite link that hasn't been used yet. */
export async function cancelSsInvite(token: string) {
  const { error } = await projectClient("SSTASKS")
    .rpc("dashboard_invite_cancel", { p_key: dashboardKey(), p_token: token })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}
