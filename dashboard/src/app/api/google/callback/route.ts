import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_STATE_COOKIE, connectGoogle, googleRedirectUri } from "@/lib/google";
import { getOwner } from "@/lib/supabase/server";

// GET /api/google/callback — Google sends the owner back here with a code.
export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.redirect(new URL("/login", request.url));

  const params = request.nextUrl.searchParams;
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?google=${result}#calendar`, request.url));
    res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/google" });
    return res;
  };

  const state = params.get("state");
  if (!state || state !== request.cookies.get(GOOGLE_STATE_COOKIE)?.value) return back("state_mismatch");
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code) return back("no_code");

  try {
    await connectGoogle(owner.supabase, code, googleRedirectUri(request.nextUrl.origin));
    return back("connected");
  } catch (e) {
    console.error("Google connect failed", e);
    return back("failed");
  }
}
