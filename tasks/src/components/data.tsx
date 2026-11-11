"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Profile, Project, Role, Workspace } from "@/lib/types";

type Member = { workspace_id: string; user_id: string; role: Role };
export type ProjectMember = { project_id: string; user_id: string; role: "owner" | "member" };
type AppData = {
  me: Profile | null;
  workspaces: Workspace[];
  projects: Project[];
  people: Map<string, Profile>;
  members: Member[];
  /** Who is added to each project I can see (projects work like Teams channels). */
  projectMembers: ProjectMember[];
  loading: boolean;
  reload: () => Promise<void>;
};

const Ctx = createContext<AppData | null>(null);

/** Who I am, my workspaces (with my role), the projects I can see and the people I work with. */
export function AppDataProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AppData, "reload">>({
    me: null,
    workspaces: [],
    projects: [],
    people: new Map(),
    members: [],
    projectMembers: [],
    loading: true,
  });

  const reload = useCallback(async () => {
    const sb = supabase();
    const [ws, members, projects, people, pm] = await Promise.all([
      sb.from("workspaces").select("id, name, color").order("name"),
      sb.from("workspace_members").select("workspace_id, user_id, role"),
      sb.from("projects").select("*").eq("archived", false).order("name"),
      sb.from("profiles").select("id, email, full_name, color"),
      sb.from("project_members").select("project_id, user_id, role"),
    ]);
    const mem = (members.data ?? []) as Member[];
    const peopleMap = new Map(((people.data ?? []) as Profile[]).map((p) => [p.id, p]));
    setState({
      me: peopleMap.get(userId) ?? null,
      workspaces: ((ws.data ?? []) as Workspace[]).map((w) => ({ ...w, role: mem.find((m) => m.workspace_id === w.id && m.user_id === userId)?.role })),
      projects: (projects.data ?? []) as Project[],
      people: peopleMap,
      members: mem,
      projectMembers: (pm.data ?? []) as ProjectMember[],
      loading: false,
    });
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return <Ctx.Provider value={{ ...state, reload }}>{children}</Ctx.Provider>;
}

/**
 * The people who can open a project, and so can be given its tasks: the
 * people added to it (projects are private, like Teams channels).
 */
export function projectPeople(data: Pick<AppData, "projects" | "members" | "projectMembers" | "people">, projectId: string): Profile[] {
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return [];
  const added = new Set(data.projectMembers.filter((x) => x.project_id === projectId).map((x) => x.user_id));
  return data.members
    .filter((m) => m.workspace_id === project.workspace_id && added.has(m.user_id))
    .map((m) => data.people.get(m.user_id))
    .filter((p): p is Profile => !!p)
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
}

export function useAppData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData outside AppDataProvider");
  return v;
}

/** Initials in a coloured circle. */
export function Avatar({ person, size = "sm" }: { person?: Profile | null; size?: "xs" | "sm" | "md" }) {
  const name = person?.full_name || person?.email || "?";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  const box = size === "xs" ? "size-5 text-[9px]" : size === "md" ? "size-9 text-sm" : "size-7 text-[11px]";
  return (
    <span title={name} className={`${box} grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-surface`} style={{ background: person?.color ?? "#94a3b8" }}>
      {initials}
    </span>
  );
}
