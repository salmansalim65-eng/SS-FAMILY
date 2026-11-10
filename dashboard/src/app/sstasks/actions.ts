"use server";

import { setSsTaskDone } from "@/lib/sstasks";
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
