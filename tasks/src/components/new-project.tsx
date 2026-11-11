"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, useAppData } from "@/components/data";
import { supabase } from "@/lib/supabase/client";
import { COLORS } from "@/lib/types";

/**
 * New project — like a Planner plan / a Teams channel: name, description,
 * colour and who is in it. Workspace owners and admins see every project, so
 * the people to pick are the workspace's members and guests.
 */
export function NewProjectDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const router = useRouter();
  const { me, workspaces, members, people, projects, reload } = useAppData();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[projects.filter((p) => p.workspace_id === workspaceId).length % COLORS.length]!);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const team = members.filter((m) => m.workspace_id === workspaceId);
  const label = (id: string) => people.get(id)?.full_name || people.get(id)?.email || "Someone";
  const needle = q.trim().toLowerCase();
  const choosable = team
    .filter((m) => m.user_id !== me?.id)
    .filter((m) => !needle || `${label(m.user_id)} ${people.get(m.user_id)?.email ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => label(a.user_id).localeCompare(label(b.user_id)));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the project a name.");
    setBusy(true);
    setError(null);
    const sb = supabase();
    const { data, error } = await sb
      .from("projects")
      .insert({ workspace_id: workspaceId, name: name.trim(), description: description.trim(), color })
      .select("id")
      .single();
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const id = data.id as string;
    if (picked.length) {
      const { error: e2 } = await sb.from("project_members").insert(picked.map((user_id) => ({ project_id: id, user_id })));
      if (e2) setError(`Project made, but adding people failed: ${e2.message}`);
    }
    await reload();
    setBusy(false);
    onClose();
    router.push(`/p/${id}`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={create}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: color }} aria-hidden />
          <h2 className="min-w-0 flex-1 text-lg font-semibold">New project{workspace ? ` in ${workspace.name}` : ""}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2 text-muted hover:text-fg">
            ✕
          </button>
        </div>

        <label className="block text-sm font-medium">
          Name *
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            dir="auto"
            placeholder="e.g. Admissions 2027"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal outline-none focus:border-accent"
          />
        </label>

        <label className="block text-sm font-medium">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={1000}
            dir="auto"
            placeholder="What is this project for? (optional)"
            className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal outline-none focus:border-accent"
          />
        </label>

        <div>
          <p className="text-sm font-medium">Colour</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                className={`size-7 rounded-full ${color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
            <p className="flex-1 text-sm font-medium">Members</p>
            <span className="text-xs text-muted">{picked.length + 1} in the project</span>
          </div>
          <div className="space-y-2 p-2">
            <p className="text-xs text-muted">
              Private: only the people you add can open this project (like a Teams channel). You become its owner.
            </p>
            {choosable.length > 0 || needle ? (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people by name"
                className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            ) : null}
            <ul className="max-h-56 divide-y divide-line overflow-y-auto">
              {choosable.map((m) => {
                const on = picked.includes(m.user_id);
                return (
                  <li key={m.user_id}>
                    <label className="flex cursor-pointer items-center gap-2 px-1 py-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setPicked((p) => (on ? p.filter((x) => x !== m.user_id) : [...p, m.user_id]))}
                        className="size-4 accent-[var(--accent)]"
                      />
                      <Avatar person={people.get(m.user_id)} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{label(m.user_id)}</span>
                        <span className="block truncate text-xs text-muted">
                          {people.get(m.user_id)?.email}
                          {m.role === "guest" ? " · guest" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {choosable.length === 0 && (
                <li className="px-1 py-2 text-xs text-muted">
                  {needle ? "Nobody matches." : "No other members in this workspace yet — invite them from People, then add them to the project."}
                </li>
              )}
            </ul>
          </div>
        </div>

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-surface-2">
            Cancel
          </button>
          <button disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
