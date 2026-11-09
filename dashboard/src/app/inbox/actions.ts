"use server";

import { actOnDocument, isInboxProject, markAlertRead } from "@/lib/inbox";
import { requireOwner } from "@/lib/supabase/server";

export type InboxResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function attempt<T>(fn: () => Promise<T>): Promise<InboxResult<T>> {
  try {
    await requireOwner();
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Something went wrong. Please try again." };
  }
}

/** Approve / reject / suspend / send back a document in SSA or RMI, as SS. */
export async function actOnInboxItem(project: string, id: string, action: string, note: string | null) {
  return attempt(async () => {
    if (!isInboxProject(project)) throw new Error("Unknown project.");
    if (!UUID.test(id)) throw new Error("Unknown document.");
    return actOnDocument(project, id, action, note?.trim().slice(0, 500) || null);
  });
}

/** Marks an alert read (all of the project's when id is null). */
export async function readInboxAlert(project: string, id: string | null) {
  return attempt(async () => {
    if (!isInboxProject(project)) throw new Error("Unknown project.");
    if (id !== null && !UUID.test(id)) throw new Error("Unknown alert.");
    await markAlertRead(project, id);
  });
}
