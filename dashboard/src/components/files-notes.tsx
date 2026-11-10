"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onDashboardRefresh } from "@/lib/refresh-event";

// Files & Notes: the owner's OneDrive (folders, recent files, search) and
// OneNote pages, read only. Files open in Office / OneNote on the web.
// Pinned folders and the open tab are remembered in this browser.

type Item = { id: string; name: string; folder: boolean; childCount: number | null; size: number | null; modified: string | null; url: string | null; path: string | null };
type Note = { id: string; title: string; modified: string | null; url: string | null; section: string | null; notebook: string | null };
type Crumb = { id: string; name: string };
type Tab = "folders" | "recent" | "notes";
type Data =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "not_configured" | "disconnected" | "reconnect"; message?: string }
  | { state: "items"; items: Item[] }
  | { state: "notes"; notes: Note[] };

const TAB_KEY = "dashboard.filesTab";
const PINS_KEY = "dashboard.filePins";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const ICONS: [RegExp, string][] = [
  [/\.(pptx?|ppsx?|key)$/i, "📊"],
  [/\.pdf$/i, "📕"],
  [/\.(docx?|rtf|odt|txt|md)$/i, "📝"],
  [/\.(xlsx?|csv|ods)$/i, "📗"],
  [/\.(png|jpe?g|gif|webp|heic|svg|bmp)$/i, "🖼️"],
  [/\.(mp4|mov|avi|mkv|webm)$/i, "🎬"],
  [/\.(mp3|m4a|wav|ogg)$/i, "🎵"],
  [/\.(zip|rar|7z)$/i, "🗜️"],
  [/\.one(toc2)?$/i, "📓"],
];
const iconFor = (i: Item) => (i.folder ? "📁" : (ICONS.find(([re]) => re.test(i.name))?.[1] ?? "📄"));

function size(n: number | null) {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "2-digit" });
const date = (s: string | null) => (s ? dateFmt.format(new Date(s)) : null);

export function FilesNotes() {
  const [tab, setTab] = useState<Tab>("folders");
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [pins, setPins] = useState<Crumb[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Data>({ state: "loading" });
  const seq = useRef(0);

  useEffect(() => {
    const t = read<Tab>(TAB_KEY, "folders");
    if (t === "recent" || t === "notes") setTab(t);
    setPins(read<Crumb[]>(PINS_KEY, []));
  }, []);

  // Search waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const folderId = trail.at(-1)?.id ?? null;

  const load = useCallback(async () => {
    const n = ++seq.current;
    setData((d) => (d.state === "items" || d.state === "notes" ? d : { state: "loading" }));
    const params = new URLSearchParams();
    if (tab === "notes") {
      params.set("view", "notes");
      if (query) params.set("q", query);
    } else if (query) {
      params.set("view", "search");
      params.set("q", query);
    } else if (tab === "recent") params.set("view", "recent");
    else {
      params.set("view", "folder");
      if (folderId) params.set("id", folderId);
    }
    try {
      const res = await fetch(`/api/files?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (n !== seq.current) return;
      if (!res.ok) throw new Error(body.error || "Could not load files");
      if (body.state !== "ok") setData({ state: body.state, message: body.error });
      else if (body.notes) setData({ state: "notes", notes: body.notes });
      else setData({ state: "items", items: body.items });
    } catch (e) {
      if (n === seq.current) setData({ state: "error", message: e instanceof Error ? e.message : "Could not load files" });
    }
  }, [tab, query, folderId]);

  useEffect(() => {
    setData({ state: "loading" });
    load();
  }, [load]);
  useEffect(() => onDashboardRefresh(load), [load]);

  function pick(t: Tab) {
    setTab(t);
    write(TAB_KEY, t);
  }
  function open(folder: Crumb, fromRoot = false) {
    setQ("");
    setQuery("");
    setTab("folders");
    setTrail((tr) => (fromRoot ? [folder] : [...tr, folder]));
  }
  const pinned = folderId ? pins.some((p) => p.id === folderId) : false;
  function togglePin() {
    const cur = trail.at(-1);
    if (!cur) return;
    const next = pinned ? pins.filter((p) => p.id !== cur.id) : [...pins, cur].slice(-12);
    setPins(next);
    write(PINS_KEY, next);
  }

  const connectBox = (text: string, label: string) => (
    <div className="space-y-3 py-6 text-center text-sm text-muted">
      <p>{text}</p>
      <a href="/api/microsoft/connect" className="inline-block rounded-xl bg-accent px-4 py-2 font-medium text-white hover:opacity-90">
        {label}
      </a>
    </div>
  );

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-lg">
          🗂️
        </span>
        <h2 className="flex-1 truncate font-semibold">Files &amp; Notes</h2>
        <a href="https://onedrive.live.com/" target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface-2">
          OneDrive ↗
        </a>
        <a href="https://www.onenote.com/notebooks" target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface-2">
          OneNote ↗
        </a>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm">
          {(
            [
              ["folders", "Folders"],
              ["recent", "Recent"],
              ["notes", "OneNote"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => pick(key)}
              className={`rounded-lg px-3 py-1 font-medium ${tab === key ? "bg-surface shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === "notes" ? "Search OneNote pages…" : "Search all files…"}
          className="min-w-0 flex-1 basis-full rounded-xl border border-line bg-surface px-3 py-1.5 text-sm sm:basis-48"
        />
      </div>

      {tab === "folders" && !query && (
        <div className="mb-2 space-y-2">
          {pins.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pins.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => open(p, true)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.id === folderId ? "bg-accent text-white" : "bg-surface-2 hover:bg-line"}`}
                >
                  ★ {p.name}
                </button>
              ))}
            </div>
          )}
          <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
            <button type="button" onClick={() => setTrail([])} className="rounded px-1 text-accent hover:underline">
              OneDrive
            </button>
            {trail.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                <span className="text-muted">›</span>
                <button type="button" onClick={() => setTrail((tr) => tr.slice(0, i + 1))} className={`rounded px-1 ${i === trail.length - 1 ? "font-medium" : "text-accent hover:underline"}`}>
                  {c.name}
                </button>
              </span>
            ))}
            {folderId && (
              <button type="button" onClick={togglePin} title={pinned ? "Unpin this folder" : "Pin this folder"} className="ml-1 rounded-full px-1.5 text-base text-amber-500 hover:bg-surface-2">
                {pinned ? "★" : "☆"}
              </button>
            )}
          </nav>
        </div>
      )}

      <div className="max-h-[26rem] min-h-[8rem] flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {data.state === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {data.state === "error" && <p className="text-sm text-danger">{data.message}</p>}
        {data.state === "not_configured" && (
          <p className="py-6 text-center text-sm text-muted">Microsoft isn&apos;t set up for the dashboard yet (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET on Vercel).</p>
        )}
        {data.state === "disconnected" && connectBox("Connect your Microsoft account to see OneDrive files and OneNote pages here.", "Connect Microsoft")}
        {data.state === "reconnect" && connectBox(data.message ?? "Microsoft needs permission for OneDrive and OneNote.", "Reconnect Microsoft")}

        {data.state === "items" &&
          (data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{query ? "Nothing found." : "This folder is empty."}</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {data.items.map((i) => {
                const meta = [i.folder ? (i.childCount != null ? `${i.childCount} ${i.childCount === 1 ? "item" : "items"}` : null) : size(i.size), date(i.modified)].filter(Boolean).join(" · ");
                const inner = (
                  <>
                    <span aria-hidden className="text-xl leading-none">
                      {iconFor(i)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{i.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {meta}
                        {(query || tab === "recent") && i.path ? ` · ${i.path}` : ""}
                      </span>
                    </span>
                    {!i.folder && (
                      <span aria-hidden className="text-xs text-muted opacity-0 transition group-hover:opacity-100">
                        ↗
                      </span>
                    )}
                  </>
                );
                const cls = "group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2";
                return (
                  <li key={i.id}>
                    {i.folder ? (
                      <button type="button" onClick={() => open({ id: i.id, name: i.name })} className={cls}>
                        {inner}
                      </button>
                    ) : (
                      <a href={i.url ?? "#"} target="_blank" rel="noopener noreferrer" className={cls}>
                        {inner}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}

        {data.state === "notes" &&
          (data.notes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{query ? "No pages match." : "No OneNote pages yet."}</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {data.notes.map((n) => (
                <li key={n.id}>
                  <a href={n.url ?? "#"} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                    <span aria-hidden className="text-xl leading-none">
                      📓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      <span className="block truncate text-xs text-muted">{[n.notebook, n.section, date(n.modified)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span aria-hidden className="text-xs text-muted opacity-0 transition group-hover:opacity-100">
                      ↗
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
