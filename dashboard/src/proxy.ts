import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth/", "/privacy"];

function isAllowed(email: string | undefined) {
  if (!email) return false;
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

// Refreshes the Supabase session cookie on every request and keeps everyone
// but the whitelisted owner out of the app.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.DASHBOARD_SUPABASE_URL;
  const anonKey = process.env.DASHBOARD_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return new NextResponse("Dashboard is not configured: set DASHBOARD_SUPABASE_URL and DASHBOARD_SUPABASE_ANON_KEY.", {
      status: 500,
    });
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  const ok = !!data.user && isAllowed(data.user.email);

  if (!ok && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  if (ok && path === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
