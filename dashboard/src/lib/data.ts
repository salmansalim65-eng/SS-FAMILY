import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardApp, DashboardCard, Settings } from "@/lib/types";

const DEFAULT_SETTINGS: Settings = {
  display_name: "Friend",
  currency: "PKR",
  google_calendar_embed_url: null,
};

export async function getApps(db: SupabaseClient, { activeOnly = false } = {}) {
  let q = db.from("dashboard_apps").select("*").order("category").order("sort_order").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load icons: ${error.message}`);
  return data as DashboardApp[];
}

export async function getCards(db: SupabaseClient, { activeOnly = false, project }: { activeOnly?: boolean; project?: string } = {}) {
  let q = db.from("dashboard_cards").select("*").order("project").order("sort_order").order("title");
  if (activeOnly) q = q.eq("is_active", true);
  if (project) q = q.eq("project", project);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load cards: ${error.message}`);
  return (data as DashboardCard[]).map((c) => ({
    ...c,
    sample_value: c.sample_value == null ? null : Number(c.sample_value),
    sample_previous: c.sample_previous == null ? null : Number(c.sample_previous),
  }));
}

export async function getSettings(db: SupabaseClient): Promise<Settings> {
  const { data, error } = await db.from("dashboard_settings").select("key, value");
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (row.key in out && row.value != null) (out as Record<string, unknown>)[row.key] = row.value;
  }
  return out;
}
