import { NextResponse, type NextRequest } from "next/server";
import { MicrosoftNotConnected } from "@/lib/microsoft";
import { listFolder, MicrosoftNeedsReconnect, notePages, recentFiles, searchFiles } from "@/lib/ms-files";
import { getOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/files?view=folder&id=…  |  view=recent  |  view=search&q=…  |  view=notes&q=…
// OneDrive and OneNote for the Files & Notes panel, read only.
export async function GET(req: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) return json({ state: "not_configured" });

  const p = req.nextUrl.searchParams;
  const view = p.get("view") ?? "folder";
  const q = (p.get("q") ?? "").trim().slice(0, 100);
  const id = p.get("id");
  try {
    if (view === "notes") return json({ state: "ok", notes: await notePages(owner.supabase, q || null) });
    if (view === "recent") return json({ state: "ok", items: await recentFiles(owner.supabase) });
    if (view === "search") return json({ state: "ok", items: q ? await searchFiles(owner.supabase, q) : [] });
    if (id && !/^[A-Za-z0-9!._-]{1,200}$/.test(id)) return json({ error: "Unknown folder." }, 400);
    return json({ state: "ok", items: await listFolder(owner.supabase, id) });
  } catch (e) {
    if (e instanceof MicrosoftNotConnected) return json({ state: "disconnected" });
    if (e instanceof MicrosoftNeedsReconnect) return json({ state: "reconnect", error: e.message });
    return json({ error: e instanceof Error ? e.message : "Could not load files" }, 502);
  }
}
