import "server-only";

/** Reads a required server-side environment variable. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** The dashboard's own Supabase project (auth + settings tables). */
export function dashboardSupabase() {
  return {
    url: requireEnv("DASHBOARD_SUPABASE_URL"),
    anonKey: requireEnv("DASHBOARD_SUPABASE_ANON_KEY"),
  };
}

/** Lower-cased emails allowed to sign in (comma separated in ALLOWED_EMAILS). */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.trim().toLowerCase());
}
