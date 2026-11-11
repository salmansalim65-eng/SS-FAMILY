"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { COLORS } from "@/lib/types";
import { Bell } from "./bell";
import { Avatar, useAppData } from "./data";

/** Sidebar (My tasks, workspaces and their projects) and the top bar. */
export function Shell({ userId, children }: { userId: string; children: React.ReactNode }) {
  const { me, workspaces, projects, reload } = useAppData();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function newWorkspace() {
    const name = prompt("Workspace (company) name");
    if (!name?.trim()) return;
    const { data, error } = await supabase().rpc("create_workspace", { p_name: name.trim(), p_color: COLORS[workspaces.length % COLORS.length] });
    if (error) return alert(error.message);
    await reload();
    router.push(`/w/${data}`);
  }

  async function signOut() {
    await supabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function toggleTheme() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("tasks.theme", dark ? "dark" : "light");
    } catch {}
  }

  const link = (href: string, active: boolean) =>
    `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? "bg-accent/10 font-medium text-accent" : "hover:bg-surface-2"}`;

  const sidebar = (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 px-2 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="size-8" />
        <span className="font-semibold">Task Hub</span>
      </Link>
      <div className="space-y-0.5">
        <Link href="/" onClick={() => setOpen(false)} className={link("/", path === "/")}>
          <span aria-hidden>☑</span> My tasks
        </Link>
      </div>
      {workspaces.map((w) => (
        <div key={w.id} className="space-y-0.5">
          <Link href={`/w/${w.id}`} onClick={() => setOpen(false)} className={`${link(`/w/${w.id}`, path === `/w/${w.id}`)} font-semibold`}>
            <span className="size-3 rounded" style={{ background: w.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.role === "guest" && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">guest</span>}
          </Link>
          {projects
            .filter((p) => p.workspace_id === w.id)
            .map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} onClick={() => setOpen(false)} className={`${link(`/p/${p.id}`, path === `/p/${p.id}`)} pl-6`}>
                <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </Link>
            ))}
        </div>
      ))}
      <button type="button" onClick={newWorkspace} className="rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-fg">
        ＋ New workspace
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {open && <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/80 px-3 py-2 backdrop-blur sm:px-5">
          <button type="button" onClick={() => setOpen(true)} aria-label="Menu" className="grid size-9 place-items-center rounded-full border border-line bg-surface lg:hidden">
            ☰
          </button>
          <div className="flex-1" />
          <Bell userId={userId} />
          <button type="button" onClick={toggleTheme} aria-label="Dark / light" className="grid size-9 place-items-center rounded-full border border-line bg-surface hover:bg-surface-2">
            ☾
          </button>
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-3">
            <Avatar person={me} />
            <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{me?.full_name}</span>
          </div>
          <button type="button" onClick={signOut} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}
