"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ago } from "@/lib/dates";
import { supabase } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types";

/** 🔔 with the unread count; live through Supabase Realtime. */
export function Bell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase().from("notifications").select("*").order("created_at", { ascending: false }).limit(40);
    setItems((data ?? []) as Notification[]);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase()
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase().removeChannel(ch);
    };
  }, [load, userId]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markAll() {
    setItems((xs) => xs.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    await supabase().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  }
  async function markOne(id: string) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)));
    await supabase().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications: ${unread} unread`}
        className="relative grid size-9 place-items-center rounded-full border border-line bg-surface hover:bg-surface-2"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs text-muted hover:text-fg">
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {items.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">Nothing yet.</li>}
              {items.map((n) => (
                <li key={n.id} className={n.read_at ? "" : "bg-accent/5"}>
                  <Link
                    href={n.project_id ? `/p/${n.project_id}${n.task_id ? `?task=${n.task_id}` : ""}` : "/"}
                    onClick={() => {
                      markOne(n.id);
                      setOpen(false);
                    }}
                    className="block px-3 py-2.5 hover:bg-surface-2"
                  >
                    <p className="text-sm">{n.title}</p>
                    {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                    <p className="text-[11px] text-muted">{ago(n.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
