"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Avatar, useAppData } from "@/components/data";
import { supabase } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

type Invite = { id: string; token: string; email: string; role: Role; project_id: string | null; created_at: string; accepted_at: string | null; expires_at: string };
type ProjectMember = { project_id: string; user_id: string };

const ROLE_HINT: Record<Role, string> = {
  owner: "Owns the workspace",
  admin: "Manages people and every project",
  member: "Sees and works on every project",
  guest: "Sees only the projects they're added to",
};

function Members() {
  const { ws } = useParams<{ ws: string }>();
  const preselect = useSearchParams().get("project");
  const { me, workspaces, projects, members, people, reload } = useAppData();
  const workspace = workspaces.find((w) => w.id === ws);
  const wsProjects = projects.filter((p) => p.workspace_id === ws);
  const team = members.filter((m) => m.workspace_id === ws);
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const canInviteGuest = workspace && workspace.role !== "guest";

  const [invites, setInvites] = useState<Invite[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(preselect ? "guest" : "member");
  const [project, setProject] = useState(preselect ?? "");
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const ids = wsProjects.map((p) => p.id);
    const [inv, pm] = await Promise.all([
      sb.from("invitations").select("*").is("accepted_at", null).order("created_at", { ascending: false }),
      ids.length ? sb.from("project_members").select("project_id, user_id").in("project_id", ids) : Promise.resolve({ data: [] }),
    ]);
    setInvites(((inv.data ?? []) as Invite[]).filter((i) => !i.project_id || ids.includes(i.project_id) || i.role !== "guest"));
    setProjectMembers((pm.data ?? []) as ProjectMember[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsProjects.map((p) => p.id).join()]);

  useEffect(() => {
    load();
  }, [load]);

  const linkFor = (token: string) => `${location.origin}/join/${token}`;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMade(null);
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) return setError("Enter a valid email.");
    if (role === "guest" && !project) return setError("Pick the project the guest joins.");
    const row: Record<string, string | undefined> =
      role === "guest" ? { project_id: project, email: clean, role, invited_by: me?.id } : { workspace_id: ws, email: clean, role, invited_by: me?.id };
    const { data, error } = await supabase().from("invitations").insert(row).select("token").single();
    if (error) return setError(error.message);
    const link = linkFor(data.token as string);
    setMade(link);
    setEmail("");
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
    load();
  }

  async function setMemberRole(userId: string, r: Role) {
    const { error } = await supabase().from("workspace_members").update({ role: r }).eq("workspace_id", ws).eq("user_id", userId);
    if (error) return setError(error.message);
    reload();
  }

  async function removeMember(userId: string) {
    const name = people.get(userId)?.full_name ?? "this person";
    if (!confirm(userId === me?.id ? "Leave this workspace?" : `Remove ${name} from ${workspace?.name}?`)) return;
    const { error } = await supabase().from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", userId);
    if (error) return setError(error.message);
    reload();
  }

  async function addToProject(userId: string, projectId: string) {
    if (!projectId) return;
    const { error } = await supabase().from("project_members").insert({ project_id: projectId, user_id: userId });
    if (error) return setError(error.message);
    load();
  }
  async function removeFromProject(userId: string, projectId: string) {
    await supabase().from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
    load();
  }

  async function cancelInvite(id: string) {
    await supabase().from("invitations").delete().eq("id", id);
    load();
  }

  if (!workspace) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{workspace.name} · People</h1>

      {canInviteGuest && (
        <form onSubmit={invite} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <p className="font-medium">Invite someone</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their@email.com"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-xl border border-line bg-surface px-2 py-2 text-sm">
              {canManage && <option value="member">Member</option>}
              {canManage && <option value="admin">Admin</option>}
              <option value="guest">Guest (one project)</option>
            </select>
            {role === "guest" && (
              <select value={project} onChange={(e) => setProject(e.target.value)} className="rounded-xl border border-line bg-surface px-2 py-2 text-sm">
                <option value="">Project…</option>
                {wsProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">Make invite link</button>
          </div>
          <p className="text-xs text-muted">{ROLE_HINT[role]}. The link works once, for that email, for 14 days — send it on WhatsApp or email.</p>
          {made && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
              <span>✓ Link copied:</span>
              <code className="min-w-0 flex-1 truncate">{made}</code>
              <a href={`https://wa.me/?text=${encodeURIComponent(`Join me on Task Hub: ${made}`)}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                WhatsApp
              </a>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      )}

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <p className="border-b border-line px-4 py-2 font-medium">Members ({team.length})</p>
        <ul className="divide-y divide-line">
          {team.map((m) => {
            const p = people.get(m.user_id);
            const theirProjects = projectMembers.filter((x) => x.user_id === m.user_id);
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Avatar person={p} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p?.full_name} {m.user_id === me?.id && <span className="text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{p?.email}</p>
                  {m.role === "guest" && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {theirProjects.map((x) => (
                        <span key={x.project_id} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px]">
                          {wsProjects.find((w) => w.id === x.project_id)?.name}
                          {canInviteGuest && (
                            <button type="button" onClick={() => removeFromProject(m.user_id, x.project_id)} aria-label="Remove from project" className="text-muted hover:text-danger">
                              ✕
                            </button>
                          )}
                        </span>
                      ))}
                      {canInviteGuest && (
                        <select value="" onChange={(e) => addToProject(m.user_id, e.target.value)} className="rounded-full border border-line bg-surface px-1.5 py-0.5 text-[11px]">
                          <option value="">＋ project</option>
                          {wsProjects
                            .filter((w) => !theirProjects.some((x) => x.project_id === w.id))
                            .map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
                {canManage && m.role !== "owner" && m.user_id !== me?.id ? (
                  <select value={m.role} onChange={(e) => setMemberRole(m.user_id, e.target.value as Role)} className="rounded-lg border border-line bg-surface px-2 py-1 text-xs">
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs capitalize">{m.role}</span>
                )}
                {m.role !== "owner" && (canManage || m.user_id === me?.id) && (
                  <button type="button" onClick={() => removeMember(m.user_id)} className="text-xs text-muted hover:text-danger">
                    {m.user_id === me?.id ? "Leave" : "Remove"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <p className="border-b border-line px-4 py-2 font-medium">Waiting to join ({invites.length})</p>
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {i.email} <span className="text-xs capitalize text-muted">· {i.role}</span>
                  {i.project_id && <span className="text-xs text-muted"> · {wsProjects.find((p) => p.id === i.project_id)?.name}</span>}
                </span>
                <button type="button" onClick={() => navigator.clipboard.writeText(linkFor(i.token))} className="text-xs text-accent hover:underline">
                  Copy link
                </button>
                <button type="button" onClick={() => cancelInvite(i.id)} className="text-xs text-muted hover:text-danger">
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense>
      <Members />
    </Suspense>
  );
}
