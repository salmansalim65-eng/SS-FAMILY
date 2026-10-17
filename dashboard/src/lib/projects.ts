import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const clients = new Map<string, SupabaseClient>();

/**
 * Server-side client for one project's own Supabase, configured by
 * <PROJECT>_SUPABASE_URL plus <PROJECT>_SUPABASE_SERVICE_ROLE_KEY (preferred,
 * bypasses that project's RLS) or <PROJECT>_SUPABASE_ANON_KEY.
 * These keys never leave the server.
 */
export function projectClient(project: string): SupabaseClient {
  if (!/^[A-Z][A-Z0-9_]*$/.test(project)) throw new Error(`Invalid project key "${project}"`);

  const cached = clients.get(project);
  if (cached) return cached;

  const url = process.env[`${project}_SUPABASE_URL`];
  const key =
    process.env[`${project}_SUPABASE_SERVICE_ROLE_KEY`] ?? process.env[`${project}_SUPABASE_ANON_KEY`];
  if (!url || !key) {
    throw new Error(`${project} is not connected — set ${project}_SUPABASE_URL and ${project}_SUPABASE_ANON_KEY`);
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clients.set(project, client);
  return client;
}
