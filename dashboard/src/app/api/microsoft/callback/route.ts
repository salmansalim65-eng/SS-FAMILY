import { NextResponse, type NextRequest } from "next/server";
import { MICROSOFT_STATE_COOKIE, connectMicrosoft, microsoftRedirectUri } from "@/lib/microsoft";
import { getOwner } from "@/lib/supabase/server";

// GET /api/microsoft/callback — Microsoft sends the owner back here with a code.
export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.redirect(new URL("/login", request.url));

  const params = request.nextUrl.searchParams;
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?microsoft=${result}#todo`, request.url));
    res.cookies.delete({ name: MICROSOFT_STATE_COOKIE, path: "/api/microsoft" });
    return res;
  };

  const state = params.get("state");
  if (!state || state !== request.cookies.get(MICROSOFT_STATE_COOKIE)?.value) return back("state_mismatch");
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code) return back("no_code");

  try {
    await connectMicrosoft(owner.supabase, code, microsoftRedirectUri(request.nextUrl.origin));
    return back("connected");
  } catch (e) {
    console.error("Microsoft connect failed", e);
    return back("failed");
  }
}
