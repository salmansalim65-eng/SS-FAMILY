"use server";

import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/supabase/server";
import type { ChecklistItem, Note, NoteColor } from "@/lib/types";

// No revalidatePath here: the notes component keeps its own state, and
// re-rendering the whole dashboard on every keystroke would refetch the cards.

export type NoteResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const COLORS: NoteColor[] = ["yellow", "pink", "green", "blue", "purple", "orange"];
const COLUMNS = "id, kind, title, body, items, color, pinned, sort_order, updated_at";

async function attempt<T>(fn: () => Promise<T>): Promise<NoteResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || "Could not save the note. Please try again." };
  }
}

function cleanItems(items: unknown): ChecklistItem[] {
  if (!Array.isArray(items)) throw new Error("Checklist items must be a list");
  if (items.length > 100) throw new Error("A checklist can have at most 100 items");
  return items.map((i) => ({
    id: typeof i?.id === "string" && i.id ? i.id.slice(0, 64) : randomUUID(),
    text: String(i?.text ?? "").slice(0, 500),
    done: Boolean(i?.done),
  }));
}

export async function createNote(kind: Note["kind"], color: NoteColor): Promise<NoteResult<Note>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    // New notes go to the front of the unpinned ones.
    const { data: first } = await supabase
      .from("dashboard_notes")
      .select("sort_order")
      .eq("pinned", false)
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabase
      .from("dashboard_notes")
      .insert({
        kind: kind === "checklist" ? "checklist" : "text",
        color: COLORS.includes(color) ? color : "yellow",
        items: kind === "checklist" ? [{ id: randomUUID(), text: "", done: false }] : [],
        sort_order: (first?.sort_order ?? 0) - 10,
      })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return data as Note;
  });
}

export type NotePatch = Partial<Pick<Note, "title" | "body" | "items" | "color" | "pinned" | "kind">>;

export async function updateNote(id: string, patch: NotePatch): Promise<NoteResult<{ updated_at: string }>> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const row: Record<string, unknown> = {};
    if (patch.title !== undefined) row.title = String(patch.title).slice(0, 200);
    if (patch.body !== undefined) row.body = String(patch.body).slice(0, 10000);
    if (patch.items !== undefined) row.items = cleanItems(patch.items);
    if (patch.pinned !== undefined) row.pinned = Boolean(patch.pinned);
    if (patch.kind !== undefined) row.kind = patch.kind === "checklist" ? "checklist" : "text";
    if (patch.color !== undefined) {
      if (!COLORS.includes(patch.color)) throw new Error("Unknown colour");
      row.color = patch.color;
    }
    const { data, error } = await supabase.from("dashboard_notes").update(row).eq("id", id).select("updated_at").single();
    if (error) throw new Error(error.message);
    return data as { updated_at: string };
  });
}

export async function deleteNote(id: string): Promise<NoteResult> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const { error } = await supabase.from("dashboard_notes").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return undefined;
  });
}

export async function reorderNotes(ids: string[]): Promise<NoteResult> {
  return attempt(async () => {
    const { supabase } = await requireOwner();
    const results = await Promise.all(
      ids.slice(0, 500).map((id, i) => supabase.from("dashboard_notes").update({ sort_order: (i + 1) * 10 }).eq("id", id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
    return undefined;
  });
}
