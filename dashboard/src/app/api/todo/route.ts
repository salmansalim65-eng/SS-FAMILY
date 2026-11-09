import { NextResponse } from "next/server";
import { GoogleNotConnected } from "@/lib/google";
import { MicrosoftNotConnected } from "@/lib/microsoft";
import { getOwner } from "@/lib/supabase/server";
import { listTasks, todoProvider } from "@/lib/todo";

export const dynamic = "force-dynamic";

// GET /api/todo — task lists and their open tasks from Google Tasks (or Microsoft To Do).
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { provider, googleNeedsReconnect } = await todoProvider(owner.supabase);
    if (!provider) return NextResponse.json({ connected: false, googleNeedsReconnect, lists: [], tasks: [] });
    const [{ lists, tasks }, colors, times, listColors, order] = await Promise.all([
      listTasks(owner.supabase, provider),
      // Missing tables (migration not run yet) just mean no colours / times.
      owner.supabase.from("dashboard_task_colors").select("task_id, color"),
      owner.supabase.from("dashboard_task_times").select("task_id, due_time, remind_minutes"),
      owner.supabase.from("dashboard_list_colors").select("list_id, color"),
      owner.supabase.from("dashboard_settings").select("value").eq("key", "task_list_order").maybeSingle(),
    ]);
    // The owner's own list order (▲ ▼ in the panel); lists not in it keep Google's order, after.
    const ids: string[] = Array.isArray(order.data?.value) ? (order.data!.value as string[]) : [];
    const rank = (id: string) => (ids.includes(id) ? ids.indexOf(id) : ids.length);
    lists.sort((a, b) => rank(a.id) - rank(b.id));
    const listColorOf = new Map((listColors.data ?? []).map((c) => [c.list_id as string, c.color]));
    for (const l of lists) l.color = listColorOf.get(l.id) ?? null;
    const colorOf = new Map((colors.data ?? []).map((c) => [c.task_id as string, c.color]));
    const timeOf = new Map((times.data ?? []).map((c) => [c.task_id as string, String(c.due_time).slice(0, 5)]));
    const remindOf = new Map((times.data ?? []).map((c) => [c.task_id as string, c.remind_minutes as number | null]));
    for (const t of tasks) {
      t.color = colorOf.get(t.id) ?? null;
      t.time = t.due ? (timeOf.get(t.id) ?? null) : null;
      t.remind = t.time ? (remindOf.get(t.id) ?? null) : null;
    }
    return NextResponse.json({ connected: true, provider, lists, tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof GoogleNotConnected || e instanceof MicrosoftNotConnected) {
      return NextResponse.json({ connected: false, googleNeedsReconnect: true, lists: [], tasks: [] });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
