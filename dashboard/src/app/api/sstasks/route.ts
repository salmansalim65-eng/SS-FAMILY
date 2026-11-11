import { NextResponse, type NextRequest } from "next/server";
import { loadSsProjects, loadSsTasks, loadSsWorkspaces, SSTASKS_URL } from "@/lib/sstasks";
import { syncSsTasksWithGoogle, type SyncResult } from "@/lib/sstasks-sync";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/sstasks — SS's open tasks from Task Hub (assigned to SS, or by SS
// to others). First keeps Task Hub and Google Tasks in step (at most once a
// minute; ?sync=now after the ↻ button or a tick).
export async function GET(req: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let sync: SyncResult | { error: string } | null = null;
  try {
    sync = await syncSsTasksWithGoogle(owner.supabase, req.nextUrl.searchParams.get("sync") === "now" ? 5 : 60);
  } catch (e) {
    sync = { error: e instanceof Error ? e.message : "Google sync failed" };
  }
  try {
    const [tasks, projects, workspaces] = await Promise.all([loadSsTasks(), loadSsProjects(), loadSsWorkspaces()]);
    return NextResponse.json({ tasks, projects, workspaces, appUrl: SSTASKS_URL, sync }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load Task Hub", appUrl: SSTASKS_URL },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
