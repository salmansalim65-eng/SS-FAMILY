"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, useAppData } from "@/components/data";
import { NewProjectDialog } from "@/components/new-project";
import { supabase } from "@/lib/supabase/client";

/** A workspace (company): its projects, with open / late counts, and its people. */
export default function WorkspacePage() {
  const { ws } = useParams<{ ws: string }>();
  const { workspaces, projects, members, people, reload } = useAppData();
  const workspace = workspaces.find((w) => w.id === ws);
  const list = projects.filter((p) => p.workspace_id === ws);
  const team = members.filter((m) => m.workspace_id === ws);
  const [counts, setCounts] = useState<Record<string, { open: number; late: number }>>({});

  useEffect(() => {
    if (!list.length) return;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    supabase()
      .from("tasks")
      .select("project_id, due_date")
      .in("project_id", list.map((p) => p.id))
      .eq("done", false)
      .then(({ data }) => {
        const c: Record<string, { open: number; late: number }> = {};
        for (const t of data ?? []) {
          const x = (c[t.project_id as string] ??= { open: 0, late: 0 });
          x.open++;
          if (t.due_date && (t.due_date as string) < today) x.late++;
        }
        setCounts(c);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((p) => p.id).join()]);

  const [creating, setCreating] = useState(false);
  const newProject = () => setCreating(true);

  const router = useRouter();
  type Hidden = { id: string; name: string; color: string; owners: string[] };
  const [hidden, setHidden] = useState<Hidden[]>([]);
  const isWsOwner = workspace?.role === "owner";
  useEffect(() => {
    if (!isWsOwner) return setHidden([]);
    supabase()
      .rpc("workspace_hidden_projects", { p_ws: ws })
      .then(({ data }) => setHidden((data as Hidden[] | null) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, isWsOwner, list.length]);

  // Safety for the workspace owner: become owner of a private project (recorded and shown in it).
  async function takeOver(h: Hidden) {
    if (
      !confirm(
        `Take over "${h.name}"?\n\nYou become an owner and can open it. This is recorded and shown inside the project${h.owners.length ? ` (owner now: ${h.owners.join(", ")})` : ""}.`,
      )
    )
      return;
    const { error } = await supabase().rpc("take_over_project", { p_project: h.id });
    if (error) return alert(error.message);
    await reload();
    router.push(`/p/${h.id}`);
  }

  // Only the owner deletes a workspace; it takes every project and task in it.
  async function removeWorkspace() {
    if (!workspace) return;
    const typed = prompt(
      `Delete the workspace "${workspace.name}" for good?\n\nAll its projects (${list.length}), tasks and people links are deleted. This cannot be undone.\n\nPress OK to delete (the name is filled in for you):`,
      workspace.name,
    );
    if (typed === null) return;
    if (typed.trim() !== workspace.name.trim()) return alert("The name didn't match, so nothing was deleted.");
    const { data, error } = await supabase().from("workspaces").delete().eq("id", ws).select("id");
    if (error) return alert(error.message);
    if (!data?.length) return alert("Only the workspace owner can delete it.");
    await reload();
    router.replace("/");
  }

  async function rename() {
    const name = prompt("Workspace name", workspace?.name);
    if (!name?.trim()) return;
    const { error } = await supabase().from("workspaces").update({ name: name.trim() }).eq("id", ws);
    if (error) return alert(error.message);
    reload();
  }

  if (!workspace) return <p className="text-sm text-muted">Loading…</p>;
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="size-4 rounded" style={{ background: workspace.color }} aria-hidden />
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        {canManage && (
          <button type="button" onClick={rename} className="text-xs text-muted hover:text-fg">
            Rename
          </button>
        )}
        {workspace.role === "owner" && (
          <button type="button" onClick={removeWorkspace} className="text-xs text-muted hover:text-danger">
            🗑 Delete workspace
          </button>
        )}
        <div className="flex-1" />
        <Link href={`/w/${ws}/members`} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm hover:bg-surface-2">
          <span className="flex -space-x-2">
            {team.slice(0, 5).map((m) => (
              <Avatar key={m.user_id} person={people.get(m.user_id)} size="xs" />
            ))}
          </span>
          {team.length} people
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((p) => (
          <Link key={p.id} href={`/p/${p.id}`} className="rounded-2xl border border-line bg-surface p-4 shadow-sm hover:shadow">
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full" style={{ background: p.color }} aria-hidden />
              <span className="font-semibold">{p.name}</span>
            </div>
            {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>}
            <p className="mt-3 text-sm">
              <b>{counts[p.id]?.open ?? 0}</b> <span className="text-muted">open</span>
              {(counts[p.id]?.late ?? 0) > 0 && (
                <span className="ml-3 text-danger">
                  <b>{counts[p.id]!.late}</b> late
                </span>
              )}
            </p>
          </Link>
        ))}
        {workspace.role !== "guest" && (
          <button type="button" onClick={newProject} className="rounded-2xl border-2 border-dashed border-line p-4 text-left text-sm text-muted hover:text-fg">
            ＋ New project
          </button>
        )}
      </div>
      {isWsOwner && hidden.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-medium text-muted">🔒 Private projects you are not in ({hidden.length})</p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {hidden.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="size-3 rounded-full" style={{ background: h.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.name}</span>
                <span className="text-xs text-muted">Owner: {h.owners.join(", ") || "—"}</span>
                <button type="button" onClick={() => takeOver(h)} className="rounded-full border border-line px-3 py-0.5 text-xs hover:border-accent hover:text-accent">
                  🛡 Take over
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Only the names are shown. Take over only when needed — it is recorded in the project.</p>
        </section>
      )}
      {creating && <NewProjectDialog workspaceId={ws} onClose={() => setCreating(false)} />}
    </div>
  );
}
