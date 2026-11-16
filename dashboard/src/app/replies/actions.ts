"use server";

import { requireOwner } from "@/lib/supabase/server";
import { REPLY_COLUMNS, type Reply } from "@/lib/replies";

export type ReplyResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<ReplyResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Could not save. Please try again." };
  }
}

function tableError(error: { code?: string; message: string }) {
  return new Error(error.code === "42P01" || error.code === "PGRST205" ? "Replies aren't set up yet (database update pending)." : error.message);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function clean(input: { sender?: unknown; message?: unknown; due?: unknown }) {
  const row: Record<string, unknown> = {};
  if (input.sender !== undefined) row.sender = String(input.sender ?? "").trim().slice(0, 120);
  if (input.message !== undefined) row.message = String(input.message ?? "").trim().slice(0, 4000);
  if (input.due !== undefined) {
    const d = input.due === null || input.due === "" ? null : String(input.due);
    if (d !== null && !DATE.test(d)) throw new Error("Pick a valid date.");
    row.due = d;
  }
  return row;
}

/** Open replies (soonest first) and the last 20 answered. */
export async function listReplies(): Promise<ReplyResult<Reply[]>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const [open, done] = await Promise.all([
      supabase.from("dashboard_replies").select(REPLY_COLUMNS).eq("done", false).order("due", { ascending: true, nullsFirst: false }).order("created_at"),
      supabase.from("dashboard_replies").select(REPLY_COLUMNS).eq("done", true).order("done_at", { ascending: false }).limit(20),
    ]);
    if (open.error) throw tableError(open.error);
    if (done.error) throw tableError(done.error);
    return [...(open.data ?? []), ...(done.data ?? [])] as Reply[];
  });
}

export async function addReply(input: { sender: string; message: string; due: string | null }): Promise<ReplyResult<Reply>> {
  return attempt(async () => {
    const row = clean(input);
    if (!row.sender && !row.message) throw new Error("Write who it is from or what it says.");
    const { supabase } = await requireOwner();
    const { data, error } = await supabase.from("dashboard_replies").insert(row).select(REPLY_COLUMNS).single();
    if (error) throw tableError(error);
    return data as Reply;
  });
}

export async function updateReply(
  id: string,
  patch: { sender?: string; message?: string; due?: string | null; done?: boolean },
): Promise<ReplyResult<Reply>> {
  return attempt(async () => {
    const row = clean(patch);
    if (patch.done !== undefined) {
      row.done = Boolean(patch.done);
      row.done_at = patch.done ? new Date().toISOString() : null;
    }
    const { supabase } = await requireOwner();
    const { data, error } = await supabase.from("dashboard_replies").update(row).eq("id", id).select(REPLY_COLUMNS).maybeSingle();
    if (error) throw tableError(error);
    if (!data) throw new Error("That message is gone.");
    return data as Reply;
  });
}

export async function deleteReply(id: string): Promise<ReplyResult> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const { error } = await supabase.from("dashboard_replies").delete().eq("id", id);
    if (error) throw tableError(error);
    return undefined;
  });
}
