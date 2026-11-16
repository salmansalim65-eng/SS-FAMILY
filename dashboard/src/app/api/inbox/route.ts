import { NextResponse } from "next/server";
import { loadInbox } from "@/lib/inbox";
import { REPLY_COLUMNS, type Reply } from "@/lib/replies";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function karachiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// GET /api/inbox — SS's authorizations and alerts from SSA, RMI and MBL, and
// the WhatsApp replies due today or late (dashboard_replies).
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [sections, replies] = await Promise.all([
    loadInbox(owner.supabase),
    owner.supabase
      .from("dashboard_replies")
      .select(REPLY_COLUMNS)
      .eq("done", false)
      .lte("due", karachiToday())
      .order("due")
      .order("created_at")
      .limit(50)
      .then(({ data }) => (data ?? []) as Reply[]),
  ]);
  return NextResponse.json({ sections, replies, today: karachiToday() }, { headers: { "Cache-Control": "no-store" } });
}
