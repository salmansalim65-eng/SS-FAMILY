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
    const [{ lists, tasks }, colors] = await Promise.all([
      listTasks(owner.supabase, provider),
      // Missing table (migration not run yet) just means no colours.
      owner.supabase.from("dashboard_task_colors").select("task_id, color"),
    ]);
    const colorOf = new Map((colors.data ?? []).map((c) => [c.task_id as string, c.color]));
    for (const t of tasks) t.color = colorOf.get(t.id) ?? null;
    return NextResponse.json({ connected: true, provider, lists, tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof GoogleNotConnected || e instanceof MicrosoftNotConnected) {
      return NextResponse.json({ connected: false, googleNeedsReconnect: true, lists: [], tasks: [] });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
