import { NextResponse, type NextRequest } from "next/server";
import { computeCards } from "@/lib/cards";
import { getCards } from "@/lib/data";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/cards?project=RMI — live numbers for one project's cards.
// Runs on the server so each project's Supabase keys stay out of the browser.
export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const project = request.nextUrl.searchParams.get("project") ?? undefined;
  if (project && !/^[A-Z][A-Z0-9_]*$/.test(project)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  try {
    const cards = await getCards(owner.supabase, { activeOnly: true, project });
    const results = await computeCards(cards);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
