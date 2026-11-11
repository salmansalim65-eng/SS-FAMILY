"use server";

import { createSsTask, setSsTaskDone, updateSsTask, type SsTaskPatch } from "@/lib/sstasks";
import { requireOwner } from "@/lib/supabase/server";

const UUID = /^[0-9a-f-]{36}$/i;

/** Ticks an SS Tasks task done (or open again), as SS. */
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

/** Adds a task in one of the owner's SS Tasks projects, assigned to the owner. */
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
