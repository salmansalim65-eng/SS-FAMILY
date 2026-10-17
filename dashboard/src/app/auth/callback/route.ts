import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Landing page for the emailed magic link. Handles both the PKCE `code`
// link and the `token_hash` link (which also works on another device).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = (params.get("type") ?? "email") as EmailOtpType;

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing code") };

  const to = request.nextUrl.clone();
  to.search = "";

  if (error) {
    to.pathname = "/login";
    to.searchParams.set("error", "link_invalid");
    return NextResponse.redirect(to);
  }

  const { data } = await supabase.auth.getUser();
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    to.pathname = "/login";
    to.searchParams.set("error", "not_allowed");
    return NextResponse.redirect(to);
  }

  to.pathname = "/";
  return NextResponse.redirect(to);
}
