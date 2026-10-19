import { NextResponse } from "next/server";
import { GoogleNotConnected, listEvents } from "@/lib/google";
import { getOwner } from "@/lib/supabase/server";
import { addDays, karachiToday, startOf } from "@/lib/time";

export const dynamic = "force-dynamic";

const DAYS = 7;

// GET /api/calendar — today's and the next week's Google Calendar events.
export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = karachiToday();
  try {
    const events = await listEvents(owner.supabase, startOf(today), startOf(addDays(today, DAYS)));
    return NextResponse.json({ connected: true, events }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof GoogleNotConnected) return NextResponse.json({ connected: false, events: [] });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
