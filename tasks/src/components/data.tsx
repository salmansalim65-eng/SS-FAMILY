"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Profile, Project, Role, Workspace } from "@/lib/types";

type Member = { workspace_id: string; user_id: string; role: Role };
type AppData = {
  me: Profile | null;
  workspaces: Workspace[];
  projects: Project[];
  people: Map<string, Profile>;
  members: Member[];
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
    loading: true,
  });

  const reload = useCallback(async () => {
    const sb = supabase();
    const [ws, members, projects, people] = await Promise.all([
      sb.from("workspaces").select("id, name, color").order("name"),
      sb.from("workspace_members").select("workspace_id, user_id, role"),
      sb.from("projects").select("*").eq("archived", false).order("name"),
      sb.from("profiles").select("id, email, full_name, color"),
    ]);
    const mem = (members.data ?? []) as Member[];
    const peopleMap = new Map(((people.data ?? []) as Profile[]).map((p) => [p.id, p]));
    setState({
      me: peopleMap.get(userId) ?? null,
      workspaces: ((ws.data ?? []) as Workspace[]).map((w) => ({ ...w, role: mem.find((m) => m.workspace_id === w.id && m.user_id === userId)?.role })),
      projects: (projects.data ?? []) as Project[],
      people: peopleMap,
      members: mem,
      loading: false,
    });
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return <Ctx.Provider value={{ ...state, reload }}>{children}</Ctx.Provider>;
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
