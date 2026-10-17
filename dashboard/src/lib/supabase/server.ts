import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dashboardSupabase, isAllowedEmail } from "@/lib/env";

/** Supabase client for the dashboard project, acting as the signed-in user. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = dashboardSupabase();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** The signed-in, whitelisted user, or null. */
export async function getOwner() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAllowedEmail(data.user.email)) return null;
  return { supabase, user: data.user };
}

/** Like getOwner, but sends anyone else to the login page. */
export async function requireOwner() {
  const owner = await getOwner();
  if (!owner) redirect("/login");
  return owner;
}
