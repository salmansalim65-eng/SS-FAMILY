export type Role = "owner" | "admin" | "member" | "guest";
export type Priority = "urgent" | "important" | "medium" | "low";

export type Profile = { id: string; email: string; full_name: string; color: string };
export type Workspace = { id: string; name: string; color: string; role?: Role; mudeer_id?: string | null };
export type Project = { id: string; workspace_id: string; name: string; description: string; color: string; archived: boolean; created_by: string | null };
export type Bucket = { id: string; project_id: string; name: string; position: number; due_date?: string | null };
export type Task = {
  id: string;
  project_id: string;
  bucket_id: string | null;
  title: string;
  notes: string;
  priority: Priority | null;
  start_date: string | null;
  due_date: string | null;
  done: boolean;
  done_at: string | null;
  position: number;
  created_by: string;
  created_at: string;
  postponed_count?: number;
  task_assignees?: { user_id: string }[];
  checklist_items?: { id: string; done: boolean }[];
};
export type ChecklistItem = { id: string; task_id: string; title: string; done: boolean; position: number };
export type Comment = { id: string; task_id: string; user_id: string; body: string; created_at: string };
export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  project_id: string | null;
  task_id: string | null;
  link?: string | null;
  read_at: string | null;
  created_at: string;
};

export const PRIORITIES: { key: Priority; label: string; chip: string }[] = [
  { key: "urgent", label: "Urgent", chip: "bg-red-600 text-white" },
  { key: "important", label: "Important", chip: "bg-orange-500 text-white" },
  { key: "medium", label: "Medium", chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  { key: "low", label: "Low", chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
];

export const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#64748b"];
