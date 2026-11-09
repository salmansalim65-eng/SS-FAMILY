import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApps } from "@/lib/data";
import { projectClient } from "@/lib/projects";

// SS's inbox from each project: the documents waiting for SS's authorization
// and SS's unread alerts, read through each project's key-guarded
// home_dashboard_inbox (supabase/project-examples/*_dashboard_inbox.sql).
// SSA and RMI can be approved from here; MBL needs its own sign-in (and MFA),
// so MBL items only link to MBL.

export const INBOX_PROJECTS = ["SSA", "RMI", "MBL"] as const;
export type InboxProject = (typeof INBOX_PROJECTS)[number];

/** Which actions each project accepts from the dashboard (none: link only). */
export const INBOX_ACTIONS: Record<InboxProject, ("approve" | "reject" | "suspend" | "send_back")[]> = {
  SSA: ["approve", "reject", "send_back"],
  RMI: ["approve", "reject", "suspend"],
  MBL: [],
};

export type InboxAuthorization = {
  id: string;
  label: string;
  detail: string | null;
  amount: number | string | null;
  date: string | null;
  link: string | null;
  can_act: boolean;
  final?: boolean;
};
export type InboxAlert = { id: string; title: string; body: string | null; link: string | null; at: string };

export type InboxSection = {
  project: InboxProject;
  name: string;
  icon: string | null;
  color: string;
  appUrl: string | null;
  authorizations: InboxAuthorization[];
  alerts: InboxAlert[];
  error: string | null;
};

const TIMEOUT_MS = 12_000;
const projectKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export function isInboxProject(p: string): p is InboxProject {
  return (INBOX_PROJECTS as readonly string[]).includes(p);
}

function dashboardKey(project: InboxProject) {
  const key = process.env[`${project}_DASHBOARD_KEY`];
  if (!key) throw new Error(`${project} has no dashboard key (${project}_DASHBOARD_KEY).`);
  return key;
}

/** A project path (or full URL) as a full URL on that project's app. */
function absolute(link: string | null, appUrl: string | null) {
  if (!link) return appUrl;
  if (/^https?:\/\//i.test(link)) return link;
  if (!appUrl) return null;
  try {
    return new URL(link, new URL(appUrl).origin).toString();
  } catch {
    return null;
  }
}

export async function loadInbox(db: SupabaseClient): Promise<InboxSection[]> {
  const apps = await getApps(db, { activeOnly: true }).catch(() => []);
  const app = new Map(apps.map((a) => [projectKey(a.name), a]));
  return Promise.all(
    INBOX_PROJECTS.map(async (project): Promise<InboxSection> => {
      const a = app.get(project);
      const base = { project, name: a?.name ?? project, icon: a?.icon ?? null, color: a?.color ?? "#64748b", appUrl: a?.url ?? null };
      try {
        const { data, error } = await projectClient(project)
          .rpc("home_dashboard_inbox", { p_key: dashboardKey(project) })
          .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
        if (error) throw new Error(error.message);
        const d = (data ?? {}) as { authorizations?: InboxAuthorization[]; alerts?: InboxAlert[] };
        return {
          ...base,
          authorizations: (d.authorizations ?? []).map((x) => ({
            ...x,
            can_act: x.can_act && INBOX_ACTIONS[project].length > 0,
            link: absolute(x.link, base.appUrl),
          })),
          alerts: (d.alerts ?? []).map((x) => ({ ...x, link: absolute(x.link, base.appUrl) })),
          error: null,
        };
      } catch (e) {
        return { ...base, authorizations: [], alerts: [], error: e instanceof Error ? e.message : "Could not load" };
      }
    }),
  );
}

/** Approve / reject / … one document in a project, as SS. Returns the new status. */
export async function actOnDocument(project: InboxProject, id: string, action: string, note: string | null) {
  if (!(INBOX_ACTIONS[project] as string[]).includes(action)) throw new Error(`${project} items are authorized in ${project} itself.`);
  const { data, error } = await projectClient(project)
    .rpc("home_dashboard_act", { p_key: dashboardKey(project), p_id: id, p_action: action, p_note: note })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
  return (data ?? {}) as { status?: string; link?: string };
}

/** Marks one alert read, or all of a project's when id is null. */
export async function markAlertRead(project: InboxProject, id: string | null) {
  const { error } = await projectClient(project)
    .rpc("home_dashboard_alert_read", { p_key: dashboardKey(project), p_id: id })
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) throw new Error(error.message);
}
