import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { MICROSOFT_STATE_COOKIE, microsoftAuthUrl, microsoftRedirectUri } from "@/lib/microsoft";
import { getOwner } from "@/lib/supabase/server";

// GET /api/microsoft/connect — sends the owner to Microsoft's sign-in page.
export async function GET(request: NextRequest) {
  if (!(await getOwner())) return NextResponse.redirect(new URL("/login", request.url));

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(microsoftAuthUrl(state, microsoftRedirectUri(request.nextUrl.origin)));
  res.cookies.set(MICROSOFT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/microsoft",
    maxAge: 600,
  });
  return res;
}
