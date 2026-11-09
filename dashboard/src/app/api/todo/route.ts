import { NextResponse } from "next/server";
import { MicrosoftNotConnected, listTodos } from "@/lib/microsoft";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/todo — Microsoft To Do lists and their open tasks.
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { lists, tasks } = await listTodos(owner.supabase);
    return NextResponse.json({ connected: true, lists, tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof MicrosoftNotConnected) return NextResponse.json({ connected: false, lists: [], tasks: [] });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
