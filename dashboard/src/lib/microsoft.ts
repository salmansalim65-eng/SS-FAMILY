import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import type { TodoList, TodoTask, TodoTaskEdit } from "@/lib/types";

// Microsoft To Do through Microsoft Graph, signed in with the owner's
// Microsoft account. The refresh token is stored encrypted, like Google's.

const GRAPH = "https://graph.microsoft.com/v1.0";
// "Pakistan Standard Time" is Windows' name for Asia/Karachi.
const GRAPH_TIME_ZONE = "Pakistan Standard Time";
const MAX_LISTS = 10;

/** Cookie holding the OAuth state between /api/microsoft/connect and the callback. */
export const MICROSOFT_STATE_COOKIE = "microsoft_oauth_state";

// Files.Read / Notes.Read: the Files & Notes panel (OneDrive and OneNote, read only).
export const MICROSOFT_SCOPES = ["openid", "email", "offline_access", "User.Read", "Tasks.ReadWrite", "Files.Read", "Notes.Read"];

/** Thrown when Microsoft no longer accepts the stored grant; the user must reconnect. */
export class MicrosoftNotConnected extends Error {}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

function client() {
  return { id: requireEnv("MICROSOFT_CLIENT_ID"), secret: requireEnv("MICROSOFT_CLIENT_SECRET") };
}

// "common" accepts both personal (outlook.com / hotmail) and work accounts.
function authority() {
  return `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0`;
}

export function microsoftRedirectUri(origin: string) {
  return `${(process.env.SITE_URL || origin).replace(/\/$/, "")}/api/microsoft/callback`;
}

export function microsoftAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    prompt: "select_account",
    state,
  });
  return `${authority()}/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = client();
  const res = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, scope: MICROSOFT_SCOPES.join(" "), ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new MicrosoftNotConnected("Microsoft access was revoked or expired");
    throw new Error(`Microsoft token error: ${json.error_description?.split("\r\n")[0] ?? json.error ?? res.status}`);
  }
  return json as TokenResponse;
}

/** Exchanges the callback code, looks up the account email and stores the connection. */
export async function connectMicrosoft(db: SupabaseClient, code: string, redirectUri: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new Error("Microsoft did not return a refresh token");

  const me = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  }).then((r) => (r.ok ? r.json() : {}));

  const { error } = await db.from("dashboard_oauth_tokens").upsert({
    provider: "microsoft",
    account_email: (me as { mail?: string; userPrincipalName?: string }).mail ?? (me as { userPrincipalName?: string }).userPrincipalName ?? null,
    refresh_token_enc: encrypt(tokens.refresh_token),
    access_token_enc: encrypt(tokens.access_token),
    access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope ?? null,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not save the Microsoft connection: ${error.message}`);
}

export async function microsoftConnection(db: SupabaseClient) {
  const { data, error } = await db
    .from("dashboard_oauth_tokens")
    .select("account_email, connected_at")
    .eq("provider", "microsoft")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { account_email: string | null; connected_at: string } | null;
}

/**
 * Forgets the connection. Microsoft has no endpoint to revoke a refresh
 * token for personal accounts; the grant itself can be removed at
 * account.live.com/consent (personal) or myapps.microsoft.com (work).
 */
export async function disconnectMicrosoft(db: SupabaseClient) {
  const { error } = await db.from("dashboard_oauth_tokens").delete().eq("provider", "microsoft");
  if (error) throw new Error(error.message);
}

/** A valid access token, refreshed (and re-stored) when the cached one is about to expire. */
export async function accessToken(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("dashboard_oauth_tokens")
    .select("refresh_token_enc, access_token_enc, access_expires_at")
    .eq("provider", "microsoft")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new MicrosoftNotConnected("Microsoft is not connected");

  if (data.access_token_enc && data.access_expires_at && new Date(data.access_expires_at).getTime() - Date.now() > 60_000) {
    return decrypt(data.access_token_enc);
  }

  // Microsoft rotates refresh tokens, so keep the new one each time.
  const tokens = await tokenRequest({ refresh_token: decrypt(data.refresh_token_enc), grant_type: "refresh_token" });
  await db
    .from("dashboard_oauth_tokens")
    .update({
      access_token_enc: encrypt(tokens.access_token),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    })
    .eq("provider", "microsoft");
  return tokens.access_token;
}

async function graph<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      prefer: `outlook.timezone="${GRAPH_TIME_ZONE}"`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new MicrosoftNotConnected("Microsoft rejected the access token");
  if (!res.ok) throw new Error(`Microsoft To Do error: ${json.error?.message ?? res.status}`);
  return json as T;
}

type GList = { id: string; displayName: string; wellknownListName?: string };
type GTask = {
  id: string;
  title: string;
  status: string;
  importance?: string;
  dueDateTime?: { dateTime: string; timeZone: string } | null;
  createdDateTime?: string;
  body?: { content?: string; contentType?: string };
};

/** The owner's lists and every open task in them (flagged emails left out). */
export async function listTodos(db: SupabaseClient): Promise<{ lists: TodoList[]; tasks: TodoTask[] }> {
  const token = await accessToken(db);
  const res = await graph<{ value?: GList[] }>(token, "/me/todo/lists");
  const lists = (res.value ?? [])
    .filter((l) => l.wellknownListName !== "flaggedEmails")
    .sort((a, b) => Number(b.wellknownListName === "defaultList") - Number(a.wellknownListName === "defaultList"))
    .slice(0, MAX_LISTS)
    .map<TodoList>((l) => ({ id: l.id, name: l.displayName, isDefault: l.wellknownListName === "defaultList" }));

  const perList = await Promise.allSettled(
    lists.map(async (list) => {
      const tasks = await graph<{ value?: GTask[] }>(
        token,
        `/me/todo/lists/${encodeURIComponent(list.id)}/tasks?$filter=${encodeURIComponent("status ne 'completed'")}&$top=100`,
      );
      return (tasks.value ?? []).map<TodoTask>((t) => ({
        id: t.id,
        listId: list.id,
        listName: list.name,
        title: t.title?.trim() || "(No title)",
        important: t.importance === "high",
        // With the Prefer header the due date comes back in Karachi time.
        due: t.dueDateTime?.dateTime ? t.dueDateTime.dateTime.slice(0, 10) : null,
        created: t.createdDateTime ?? null,
        notes: t.body?.contentType === "text" && t.body.content?.trim() ? t.body.content.trim() : null,
        done: false,
      }));
    }),
  );
  if (lists.length > 0 && perList[0]?.status === "rejected") throw perList[0].reason;

  const tasks = perList
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort(
      (a, b) =>
        (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
        Number(b.important) - Number(a.important) ||
        (b.created ?? "").localeCompare(a.created ?? ""),
    );
  return { lists, tasks };
}

/** Adds a task and returns its id. */
export async function addTodo(db: SupabaseClient, listId: string, title: string, due: string | null): Promise<string | null> {
  const token = await accessToken(db);
  const created = await graph<{ id?: string } | undefined>(token, `/me/todo/lists/${encodeURIComponent(listId)}/tasks`, {
    method: "POST",
    body: { title, ...(due ? { dueDateTime: { dateTime: `${due}T00:00:00`, timeZone: GRAPH_TIME_ZONE } } : {}) },
  });
  return created?.id ?? null;
}

export async function setTodoDone(db: SupabaseClient, listId: string, taskId: string, done: boolean) {
  const token = await accessToken(db);
  await graph(token, `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: { status: done ? "completed" : "notStarted" },
  });
}

export async function updateTodo(db: SupabaseClient, listId: string, taskId: string, edit: TodoTaskEdit) {
  const token = await accessToken(db);
  await graph(token, `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: {
      title: edit.title,
      body: { content: edit.notes, contentType: "text" },
      dueDateTime: edit.due ? { dateTime: `${edit.due}T00:00:00`, timeZone: GRAPH_TIME_ZONE } : null,
    },
  });
}

export async function deleteTodo(db: SupabaseClient, listId: string, taskId: string) {
  const token = await accessToken(db);
  await graph(token, `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}
