import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessToken, MicrosoftNotConnected } from "@/lib/microsoft";

// The Files & Notes panel: the owner's OneDrive (folders, recent files,
// search) and OneNote (recent pages, notebooks), read only, through
// Microsoft Graph with the same connection as Microsoft To Do.

const GRAPH = "https://graph.microsoft.com/v1.0";

export type DriveItem = {
  id: string;
  name: string;
  folder: boolean;
  childCount: number | null;
  size: number | null;
  modified: string | null;
  url: string | null;
  path: string | null; // parent folder, for search / recent results
};
export type NotePage = { id: string; title: string; modified: string | null; url: string | null; section: string | null; notebook: string | null };

export class MicrosoftNeedsReconnect extends Error {}

async function graph<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new MicrosoftNotConnected("Microsoft rejected the access token");
  if (res.status === 403) throw new MicrosoftNeedsReconnect("Microsoft needs permission for OneDrive / OneNote — reconnect it in Settings.");
  if (!res.ok) throw new Error(`Microsoft error: ${json.error?.message ?? res.status}`);
  return json as T;
}

type GItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: object;
  parentReference?: { path?: string; id?: string };
  remoteItem?: { id?: string; folder?: { childCount?: number }; webUrl?: string; parentReference?: { driveId?: string } };
};

const SELECT = "$select=id,name,size,webUrl,lastModifiedDateTime,folder,file,parentReference,remoteItem";

function item(g: GItem): DriveItem {
  const folder = !!(g.folder ?? g.remoteItem?.folder);
  return {
    id: g.id,
    name: g.name,
    folder,
    childCount: g.folder?.childCount ?? g.remoteItem?.folder?.childCount ?? null,
    size: folder ? null : (g.size ?? null),
    modified: g.lastModifiedDateTime ?? null,
    url: g.webUrl ?? g.remoteItem?.webUrl ?? null,
    // "/drive/root:/RMI/Manuals" → "RMI / Manuals"
    path: g.parentReference?.path ? decodeURIComponent(g.parentReference.path.replace(/^.*root:?/, "")).replace(/^\//, "").replace(/\//g, " / ") || null : null,
  };
}

const sortItems = (a: DriveItem, b: DriveItem) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true });

/** A folder's contents (the OneDrive root when id is null), folders first. */
export async function listFolder(db: SupabaseClient, id: string | null): Promise<DriveItem[]> {
  const token = await accessToken(db);
  const base = id ? `/me/drive/items/${encodeURIComponent(id)}` : "/me/drive/root";
  const res = await graph<{ value: GItem[] }>(token, `${base}/children?${SELECT}&$top=500`);
  return (res.value ?? []).map(item).sort(sortItems);
}

export async function recentFiles(db: SupabaseClient): Promise<DriveItem[]> {
  const token = await accessToken(db);
  const res = await graph<{ value: GItem[] }>(token, `/me/drive/recent?$top=30`);
  return (res.value ?? []).map(item).filter((i) => !i.folder);
}

export async function searchFiles(db: SupabaseClient, q: string): Promise<DriveItem[]> {
  const token = await accessToken(db);
  const safe = q.replace(/'/g, "''");
  const res = await graph<{ value: GItem[] }>(token, `/me/drive/root/search(q='${encodeURIComponent(safe)}')?${SELECT}&$top=50`);
  return (res.value ?? []).map(item).sort(sortItems);
}

type GPage = {
  id: string;
  title?: string;
  lastModifiedDateTime?: string;
  links?: { oneNoteWebUrl?: { href?: string } };
  parentSection?: { displayName?: string };
  parentNotebook?: { displayName?: string };
};

/** Recently changed OneNote pages, filtered by title when q is given. */
export async function notePages(db: SupabaseClient, q: string | null): Promise<NotePage[]> {
  const token = await accessToken(db);
  const res = await graph<{ value: GPage[] }>(
    token,
    `/me/onenote/pages?$top=100&$orderby=lastModifiedDateTime desc&$select=id,title,lastModifiedDateTime,links&$expand=parentSection($select=displayName),parentNotebook($select=displayName)`,
  );
  const needle = q?.trim().toLowerCase();
  return (res.value ?? [])
    .map((p) => ({
      id: p.id,
      title: p.title?.trim() || "Untitled page",
      modified: p.lastModifiedDateTime ?? null,
      url: p.links?.oneNoteWebUrl?.href ?? null,
      section: p.parentSection?.displayName ?? null,
      notebook: p.parentNotebook?.displayName ?? null,
    }))
    .filter((p) => !needle || `${p.title} ${p.section ?? ""} ${p.notebook ?? ""}`.toLowerCase().includes(needle))
    .slice(0, 40);
}
