import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { TIME_ZONE } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Cookie holding the OAuth state between /api/google/connect and the callback. */
export const GOOGLE_STATE_COOKIE = "google_oauth_state";

const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_SCOPES = ["openid", "email", READ_SCOPE, WRITE_SCOPE];
const MAX_CALENDARS = 10;

/** Thrown when Google no longer accepts the stored grant; the user must reconnect. */
export class GoogleNotConnected extends Error {}

/** Connected before adding events was possible: reconnect to grant calendar.events. */
export class GoogleNeedsReconnect extends Error {}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

function client() {
  return { id: requireEnv("GOOGLE_CLIENT_ID"), secret: requireEnv("GOOGLE_CLIENT_SECRET") };
}

export function googleRedirectUri(origin: string) {
  return `${(process.env.SITE_URL || origin).replace(/\/$/, "")}/api/google/callback`;
}

export function googleAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = client();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GoogleNotConnected("Google access was revoked or expired");
    throw new Error(`Google token error: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json as TokenResponse;
}

/** Exchanges the callback code, looks up the account email and stores the connection. */
export async function connectGoogle(db: SupabaseClient, code: string, redirectUri: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token");

  const info = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(10_000),
  }).then((r) => (r.ok ? r.json() : {}));

  const { error } = await db.from("dashboard_oauth_tokens").upsert({
    provider: "google",
    account_email: (info as { email?: string }).email ?? null,
    refresh_token_enc: encrypt(tokens.refresh_token),
    access_token_enc: encrypt(tokens.access_token),
    access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope ?? null,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not save the Google connection: ${error.message}`);
}

export async function googleConnection(db: SupabaseClient) {
  const { data, error } = await db
    .from("dashboard_oauth_tokens")
    .select("account_email, connected_at, scope")
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { account_email: data.account_email as string | null, connected_at: data.connected_at as string, canWrite: canWrite(data.scope) };
}

function canWrite(scope: string | null) {
  return (scope ?? "").split(" ").includes(WRITE_SCOPE);
}

export async function disconnectGoogle(db: SupabaseClient) {
  const { data } = await db.from("dashboard_oauth_tokens").select("refresh_token_enc").eq("provider", "google").maybeSingle();
  if (data?.refresh_token_enc) {
    // Best effort: tell Google too, so the grant disappears from the account.
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decrypt(data.refresh_token_enc) }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }
  const { error } = await db.from("dashboard_oauth_tokens").delete().eq("provider", "google");
  if (error) throw new Error(error.message);
}

/** A valid access token, refreshed (and re-stored) when the cached one is about to expire. */
async function accessToken(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("dashboard_oauth_tokens")
    .select("refresh_token_enc, access_token_enc, access_expires_at")
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new GoogleNotConnected("Google Calendar is not connected");

  if (data.access_token_enc && data.access_expires_at && new Date(data.access_expires_at).getTime() - Date.now() > 60_000) {
    return decrypt(data.access_token_enc);
  }

  const tokens = await tokenRequest({ refresh_token: decrypt(data.refresh_token_enc), grant_type: "refresh_token" });
  await db
    .from("dashboard_oauth_tokens")
    .update({
      access_token_enc: encrypt(tokens.access_token),
      access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      ...(tokens.refresh_token ? { refresh_token_enc: encrypt(tokens.refresh_token) } : {}),
    })
    .eq("provider", "google");
  return tokens.access_token;
}

async function calendarGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${CALENDAR_API}${path}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleNotConnected("Google rejected the access token");
  if (!res.ok) throw new Error(`Google Calendar error: ${json.error?.message ?? res.status}`);
  return json as T;
}

type GCalendar = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
  primary?: boolean;
  accessRole?: string;
};
type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  colorId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

// Google's fixed palette for per-event colours (colorId), as shown in Google Calendar.
const EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73", "5": "#f6bf26", "6": "#f4511e",
  "7": "#039be5", "8": "#616161", "9": "#3f51b5", "10": "#0b8043", "11": "#d50000",
};

/** Events from every calendar shown in the user's Google Calendar, between two RFC 3339 instants. */
export async function listEvents(
  db: SupabaseClient,
  timeMin: string,
  timeMax: string,
): Promise<{ events: CalendarEvent[]; calendars: WritableCalendar[] }> {
  const token = await accessToken(db);
  const list = await calendarGet<{ items?: GCalendar[] }>(token, "/users/me/calendarList", { minAccessRole: "reader" });
  const calendars = (list.items ?? [])
    .filter((c) => c.primary || (c.selected && !c.hidden))
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary))
    .slice(0, MAX_CALENDARS);

  const perCalendar = await Promise.allSettled(
    calendars.map(async (cal) => {
      const res = await calendarGet<{ items?: GEvent[] }>(token, `/calendars/${encodeURIComponent(cal.id)}/events`, {
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        timeZone: TIME_ZONE,
      });
      return (res.items ?? [])
        .filter((e) => e.status !== "cancelled")
        .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
        .map<CalendarEvent>((e) => ({
          id: `${cal.id}:${e.id}`,
          title: e.summary?.trim() || "(No title)",
          start: e.start?.dateTime ?? e.start?.date ?? "",
          end: e.end?.dateTime ?? e.end?.date ?? "",
          allDay: !e.start?.dateTime,
          location: e.location ?? null,
          link: e.htmlLink ?? null,
          calendar: cal.summaryOverride ?? cal.summary ?? "Calendar",
          color: (e.colorId && EVENT_COLORS[e.colorId]) || cal.backgroundColor || null,
        }));
    }),
  );

  // The primary calendar failing means nothing useful can be shown; others are optional.
  if (perCalendar[0]?.status === "rejected") throw perCalendar[0].reason;
  const events = perCalendar
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const writable = calendars
    .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
    .map((c) => ({ id: c.id, name: c.primary ? "My calendar" : (c.summaryOverride ?? c.summary ?? "Calendar"), color: c.backgroundColor ?? null }));
  return { events, calendars: writable };
}

export type WritableCalendar = { id: string; name: string; color: string | null };

export type NewEvent = {
  calendarId: string;
  title: string;
  location: string;
  description: string;
} & ({ allDay: true; startDate: string; endDate: string } | { allDay: false; start: string; end: string });

/**
 * Adds an event. Dates are YYYY-MM-DD; timed events take local date-times
 * (YYYY-MM-DDTHH:MM) in TIME_ZONE. endDate is inclusive here and converted to
 * Google's exclusive end.
 */
export async function createEvent(db: SupabaseClient, input: NewEvent) {
  const { data } = await db.from("dashboard_oauth_tokens").select("scope").eq("provider", "google").maybeSingle();
  if (data && !canWrite(data.scope)) throw new GoogleNeedsReconnect("Reconnect Google Calendar to allow adding events");
  const token = await accessToken(db);

  const nextDay = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
  };
  const body = {
    summary: input.title,
    location: input.location || undefined,
    description: input.description || undefined,
    ...(input.allDay
      ? { start: { date: input.startDate }, end: { date: nextDay(input.endDate) } }
      : {
          start: { dateTime: `${input.start}:00`, timeZone: TIME_ZONE },
          end: { dateTime: `${input.end}:00`, timeZone: TIME_ZONE },
        }),
  };

  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new GoogleNotConnected("Google rejected the access token");
  if (res.status === 403 && /insufficient|scope/i.test(json.error?.message ?? "")) {
    throw new GoogleNeedsReconnect("Reconnect Google Calendar to allow adding events");
  }
  if (!res.ok) throw new Error(`Google Calendar error: ${json.error?.message ?? res.status}`);
}

// Sort by local wall-clock time (events come back in TIME_ZONE because of the
// timeZone parameter); all-day events go first within their day (" " < "T").
function sortKey(e: CalendarEvent) {
  return e.allDay ? `${e.start} ` : e.start.slice(0, 19);
}
