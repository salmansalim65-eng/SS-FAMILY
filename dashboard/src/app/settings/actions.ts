"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/supabase/server";
import type { CardFilter } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FILTER_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "is", "in", "like", "ilike"]);

function str(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string) {
  return str(form, key) || null;
}

function num(form: FormData, key: string) {
  const v = str(form, key);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

function httpUrl(value: string, label: string) {
  try {
    const u = new URL(value);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {}
  throw new Error(`${label} must be a full http(s) URL`);
}

async function run(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

// ---------------------------------------------------------------- settings
export async function saveGeneral(form: FormData) {
  return run(async () => {
    const { supabase } = await requireOwner();
    const embed = str(form, "google_calendar_embed_url");
    if (embed && !embed.startsWith("https://calendar.google.com/calendar/")) {
      throw new Error("The calendar URL should start with https://calendar.google.com/calendar/ (use the embed link from Google Calendar settings)");
    }
    const currency = str(form, "currency").toUpperCase() || "PKR";
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter code such as PKR");

    const rows = [
      { key: "display_name", value: str(form, "display_name") || "Friend" },
      { key: "currency", value: currency },
      { key: "google_calendar_embed_url", value: embed || null },
    ];
    const { error } = await supabase.from("dashboard_settings").upsert(rows);
    if (error) throw new Error(error.message);
  });
}

// ---------------------------------------------------------------- icons
export async function saveApp(form: FormData) {
  return run(async () => {
    const { supabase } = await requireOwner();
    const id = optional(form, "id");
    const category = str(form, "category") === "personal" ? "personal" : "project";
    const color = str(form, "color").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error("Pick a colour");
    const name = str(form, "name");
    if (!name) throw new Error("Name is required");

    const row = {
      name,
      url: httpUrl(str(form, "url"), "Link"),
      icon: optional(form, "icon"),
      color,
      category,
      is_active: form.get("is_active") === "on",
    };

    if (id) {
      const { error } = await supabase.from("dashboard_apps").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: last } = await supabase
        .from("dashboard_apps")
        .select("sort_order")
        .eq("category", category)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await supabase.from("dashboard_apps").insert({ ...row, sort_order: (last?.sort_order ?? 0) + 10 });
      if (error) throw new Error(error.message);
    }
  });
}

export async function deleteApp(id: string) {
  return run(async () => {
    const { supabase } = await requireOwner();
    const { error } = await supabase.from("dashboard_apps").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
}

export async function reorderApps(ids: string[]) {
  return run(async () => {
    const { supabase } = await requireOwner();
    const results = await Promise.all(
      ids.map((id, i) => supabase.from("dashboard_apps").update({ sort_order: (i + 1) * 10 }).eq("id", id)),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
  });
}

// ---------------------------------------------------------------- cards
function parseFilter(raw: string): CardFilter[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Filter must be valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Filter must be a JSON array");
  for (const f of parsed) {
    if (!f || typeof f !== "object" || !IDENT.test(f.column) || !FILTER_OPS.has(f.op)) {
      throw new Error('Each filter needs {"column": "...", "op": "eq|neq|gt|gte|lt|lte|is|in|like|ilike", "value": ...}');
    }
  }
  return parsed as CardFilter[];
}

export async function saveCard(form: FormData) {
  return run(async () => {
    const { supabase } = await requireOwner();
    const id = optional(form, "id");
    const project = str(form, "project").toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(project)) throw new Error("Project must be letters/numbers, e.g. RMI");
    const title = str(form, "title");
    if (!title) throw new Error("Title is required");

    const query_type = str(form, "query_type");
    if (!["count", "sum", "rpc", "placeholder"].includes(query_type)) throw new Error("Pick a query type");
    for (const key of ["table_name", "value_column", "date_column"]) {
      const v = str(form, key);
      if (v && !IDENT.test(v)) throw new Error(`${key} may only contain letters, numbers and _`);
    }
    if (query_type !== "placeholder" && !str(form, "table_name")) {
      throw new Error(query_type === "rpc" ? "Enter the function name" : "Enter the table name");
    }
    if (query_type === "sum" && !str(form, "value_column")) throw new Error("A sum card needs a value column");

    const row = {
      project,
      title,
      query_type,
      table_name: optional(form, "table_name"),
      value_column: optional(form, "value_column"),
      date_column: optional(form, "date_column"),
      date_range: ["today", "this_month"].includes(str(form, "date_range")) ? str(form, "date_range") : "all",
      filter: parseFilter(str(form, "filter")),
      format: ["currency", "percent"].includes(str(form, "format")) ? str(form, "format") : "number",
      sample_value: num(form, "sample_value"),
      sample_previous: num(form, "sample_previous"),
      higher_is_better: form.get("higher_is_better") === "on",
      sort_order: num(form, "sort_order") ?? 100,
      is_active: form.get("is_active") === "on",
    };

    const { error } = id
      ? await supabase.from("dashboard_cards").update(row).eq("id", id)
      : await supabase.from("dashboard_cards").insert(row);
    if (error) throw new Error(error.message);
  });
}

export async function deleteCard(id: string) {
  return run(async () => {
    const { supabase } = await requireOwner();
    const { error } = await supabase.from("dashboard_cards").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
}
