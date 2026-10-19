import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_STATE_COOKIE, googleAuthUrl, googleRedirectUri } from "@/lib/google";
import { getOwner } from "@/lib/supabase/server";

// GET /api/google/connect — sends the owner to Google's consent screen.
export async function GET(request: NextRequest) {
  if (!(await getOwner())) return NextResponse.redirect(new URL("/login", request.url));

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(state, googleRedirectUri(request.nextUrl.origin)));
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return res;
}
