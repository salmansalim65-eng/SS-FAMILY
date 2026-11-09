import { NextResponse } from "next/server";
import { loadInbox } from "@/lib/inbox";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/inbox — SS's authorizations and alerts from SSA, RMI and MBL.
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sections = await loadInbox(owner.supabase);
  return NextResponse.json({ sections }, { headers: { "Cache-Control": "no-store" } });
}
