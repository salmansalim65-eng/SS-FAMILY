import { NextResponse, type NextRequest } from "next/server";
import { GoogleNotConnected, googleConnection, listEvents } from "@/lib/google";
import { getOwner } from "@/lib/supabase/server";
import { addDays, karachiToday, startOf, type Ymd } from "@/lib/time";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;

function parseYmd(value: string | null): Ymd | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}

// GET /api/calendar?from=YYYY-MM-DD&days=7 — Google Calendar events for
// `days` days starting at `from` (Asia/Karachi). Defaults to today and a week.
export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const from = parseYmd(params.get("from")) ?? karachiToday();
  const days = Math.min(Math.max(Math.trunc(Number(params.get("days"))) || DEFAULT_DAYS, 1), MAX_DAYS);
  try {
    const [{ events, calendars }, connection] = await Promise.all([
      listEvents(owner.supabase, startOf(from), startOf(addDays(from, days))),
      googleConnection(owner.supabase),
    ]);
    return NextResponse.json(
      { connected: true, canWrite: connection?.canWrite ?? false, events, calendars },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof GoogleNotConnected) return NextResponse.json({ connected: false, events: [], calendars: [] });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
