"use server";

import { assignSsTask, assignSsTaskByEmail, createSsProject, createSsTask, shareSsProject, setSsTaskDone, updateSsTask, type AssignByEmailResult, type ShareResult, type SsTaskPatch } from "@/lib/sstasks";
import { requireOwner } from "@/lib/supabase/server";

const UUID = /^[0-9a-f-]{36}$/i;

/** Ticks an Task Hub task done (or open again), as SS. */
export async function tickSsTask(id: string, done: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(id)) throw new Error("Unknown task.");
    await setSsTaskDone(id, done);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Something went wrong." };
  }
}

const PRIORITIES = ["urgent", "important", "medium", "low"];

/** Adds a task in one of the owner's Task Hub projects, assigned to the owner. */
export async function addSsTask(
  project: string,
  title: string,
  due: string | null,
  priority: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(project)) throw new Error("Pick a project.");
    const t = title.trim().slice(0, 300);
    if (!t) throw new Error("A task needs a title.");
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Unknown date.");
    if (priority && !PRIORITIES.includes(priority)) throw new Error("Unknown priority.");
    return { ok: true, id: await createSsTask(project, t, due || null, priority || null) };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Something went wrong." };
  }
}

/** Moves or edits a task from the panel: due date, priority, project or column. */
export async function editSsTask(id: string, patch: SsTaskPatch): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(id)) throw new Error("Unknown task.");
    const clean: SsTaskPatch = {};
    if (patch.title !== undefined) {
      const t = String(patch.title).trim().slice(0, 300);
      if (!t) throw new Error("A task needs a title.");
      clean.title = t;
    }
    if (patch.due !== undefined) {
      if (patch.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due)) throw new Error("Unknown date.");
      clean.due = patch.due;
    }
    if (patch.priority !== undefined) {
      if (patch.priority && !PRIORITIES.includes(patch.priority)) throw new Error("Unknown priority.");
      clean.priority = patch.priority || null;
    }
    if (patch.project !== undefined) {
      if (!UUID.test(patch.project)) throw new Error("Unknown project.");
      clean.project = patch.project;
    }
    if (patch.bucket !== undefined) clean.bucket = String(patch.bucket).slice(0, 60);
    await updateSsTask(id, clean);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Something went wrong." };
  }
}

/** Assigns a task to someone on its project (on) or takes it back (off). */
export async function assignTask(id: string, user: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(id) || !UUID.test(user)) throw new Error("Unknown task or person.");
    await assignSsTask(id, user, on);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Something went wrong." };
  }
}

/** Assigns a task by email (someone new gets an invite link and the task waits for them). */
export async function assignTaskByEmail(id: string, email: string): Promise<{ ok: true; data: AssignByEmailResult } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(id)) throw new Error("Unknown task.");
    const e = String(email).trim().toLowerCase().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("That email address does not look right.");
    return { ok: true, data: await assignSsTaskByEmail(id, e) };
  } catch (err) {
    return { ok: false, error: (err instanceof Error && err.message) || "Something went wrong." };
  }
}

/** Adds a project to one of SS's workspaces in Task Hub. */
export async function addSsProject(workspace: string, name: string, color: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(workspace)) throw new Error("Pick a workspace.");
    const n = name.trim().slice(0, 120);
    if (!n) throw new Error("A project needs a name.");
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Unknown colour.");
    return { ok: true, id: await createSsProject(workspace, n, color) };
  } catch (err) {
    return { ok: false, error: (err instanceof Error && err.message) || "Something went wrong." };
  }
}

/** Shares an Task Hub project with someone by email. */
export async function shareProject(project: string, email: string): Promise<{ ok: true; data: ShareResult } | { ok: false; error: string }> {
  try {
    await requireOwner();
    if (!UUID.test(project)) throw new Error("Pick a project.");
    const e = String(email).trim().toLowerCase().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("That email address does not look right.");
    return { ok: true, data: await shareSsProject(project, e) };
  } catch (err) {
    return { ok: false, error: (err instanceof Error && err.message) || "Something went wrong." };
  }
}
