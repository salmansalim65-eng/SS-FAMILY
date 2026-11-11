"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Attachment = { id: string; task_id: string; name: string; path: string; size: number | null; mime: string | null; uploaded_by: string; created_at: string };

const BUCKET = "task-files";
const MAX = 25 * 1024 * 1024;

const sizeLabel = (n: number | null) =>
  n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const icon = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)) return "🖼";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📘";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (["ppt", "pptx"].includes(ext)) return "📙";
  return "📄";
};

/**
 * A task's files: upload (several at once, up to 25 MB each), open and remove.
 * Files are private — opening one makes a short-lived link.
 */
export function Attachments({ taskId, myId, canRemoveAll }: { taskId: string; myId: string | null; canRemoveAll: boolean }) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().from("task_attachments").select("*").eq("task_id", taskId).order("created_at");
    setFiles((data ?? []) as Attachment[]);
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const sb = supabase();
    for (const f of Array.from(list)) {
      if (f.size > MAX) {
        setError(`"${f.name}" is bigger than 25 MB.`);
        continue;
      }
      setBusy(`Uploading ${f.name}…`);
      const safe = f.name.replace(/[^\w.\-() ]+/g, "_").slice(-120) || "file";
      const path = `${taskId}/${crypto.randomUUID()}-${safe}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) {
        setError(`${f.name}: ${up.error.message}`);
        continue;
      }
      const { error } = await sb.from("task_attachments").insert({ task_id: taskId, name: f.name.slice(0, 255), path, size: f.size, mime: f.type || null });
      if (error) {
        await sb.storage.from(BUCKET).remove([path]);
        setError(`${f.name}: ${error.message}`);
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    load();
  }

  async function open(a: Attachment) {
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(a.path, 120);
    if (error || !data) return setError(error?.message ?? "Couldn't open the file.");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(a: Attachment) {
    if (!confirm(`Remove "${a.name}"?`)) return;
    setError(null);
    const sb = supabase();
    const { data, error } = await sb.from("task_attachments").delete().eq("id", a.id).select("id");
    if (error) return setError(error.message);
    if (!data?.length) return setError("Only the person who added this file, or a workspace owner/admin, can remove it.");
    await sb.storage.from(BUCKET).remove([a.path]);
    load();
  }

  return (
    <div
      className="space-y-2 rounded-xl border border-line p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">📎 Attachments {files.length > 0 && <span className="text-xs text-muted">({files.length})</span>}</span>
        <button type="button" onClick={() => input.current?.click()} disabled={!!busy} className="rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-60">
          ＋ Add file
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {files.length === 0 && !busy && <p className="text-xs text-muted">Drop files here or use “Add file” (up to 25 MB each).</p>}
      <ul className="space-y-1">
        {files.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 text-sm">
            <span aria-hidden>{icon(a.name)}</span>
            <button type="button" onClick={() => open(a)} className="min-w-0 flex-1 truncate text-left text-accent hover:underline" title={a.name}>
              {a.name}
            </button>
            <span className="shrink-0 text-xs text-muted">
              {sizeLabel(a.size)} · {dateLabel(a.created_at)}
            </span>
            {(a.uploaded_by === myId || canRemoveAll) && (
              <button type="button" onClick={() => remove(a)} aria-label={`Remove ${a.name}`} className="text-xs text-muted opacity-60 hover:text-danger group-hover:opacity-100">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {busy && <p className="text-xs text-muted">{busy}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
