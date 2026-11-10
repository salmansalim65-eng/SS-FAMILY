import { NextResponse } from "next/server";
import { loadSsTasks, SSTASKS_URL } from "@/lib/sstasks";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/sstasks — SS's open tasks from SS Tasks (assigned to SS, or by SS to others).
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const tasks = await loadSsTasks();
    return NextResponse.json({ tasks, appUrl: SSTASKS_URL }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load SS Tasks", appUrl: SSTASKS_URL },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
