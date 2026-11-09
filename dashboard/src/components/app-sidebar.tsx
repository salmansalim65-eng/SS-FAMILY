"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { DashboardApp } from "@/lib/types";
import { AppGlyph } from "./app-icon";

// The app icons live in a sidebar on the left. On large screens it sits
// beside the page and its open/closed choice is remembered; on smaller
// screens it slides over the page and closes after a tap outside.

const OPEN_KEY = "dashboard.sidebarOpen";
const WIDE = "(min-width: 1024px)";

type SidebarState = { open: boolean; toggle: () => void };
const SidebarContext = createContext<SidebarState | null>(null);

/** The open/close switch, for the header; null outside a sidebar layout. */
export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarLayout({ groups, children }: { groups: DashboardApp[][]; children: React.ReactNode }) {
  const [wide, setWide] = useState(true);
  const [wideOpen, setWideOpen] = useState(true);
  const [narrowOpen, setNarrowOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    setWide(mq.matches);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    try {
      if (localStorage.getItem(OPEN_KEY) === "0") setWideOpen(false);
    } catch {}
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const open = wide ? wideOpen : narrowOpen;
  const toggle = useCallback(() => {
    if (window.matchMedia(WIDE).matches) {
      setWideOpen((o) => {
        try {
          localStorage.setItem(OPEN_KEY, o ? "0" : "1");
        } catch {}
        return !o;
      });
    } else {
      setNarrowOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    if (!narrowOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNarrowOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrowOpen]);

  const nonEmpty = groups.filter((g) => g.length > 0);

  return (
    <SidebarContext.Provider value={{ open, toggle }}>
      <div className="flex min-h-dvh">
        {narrowOpen && !wide && (
          <button
            type="button"
            aria-label="Close apps"
            onClick={() => setNarrowOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
          />
        )}
        <aside
          id="app-sidebar"
          aria-label="Apps"
          className={`fixed inset-y-0 left-0 z-50 w-60 shrink-0 transition-transform duration-200 lg:sticky lg:top-0 lg:z-20 lg:h-dvh ${
            narrowOpen ? "translate-x-0" : "-translate-x-full"
          } ${wideOpen ? "lg:block lg:translate-x-0" : "lg:hidden"}`}
        >
          <div className="flex h-full flex-col border-r border-line bg-surface shadow-xl lg:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_8%,var(--surface)),var(--surface)_45%)] lg:shadow-none">
            <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logos/ss-dashboard.svg" alt="" className="size-8 rounded-lg" />
              <span className="flex-1 truncate font-semibold">SS Dashboard</span>
              <button
                type="button"
                onClick={toggle}
                aria-label="Close sidebar"
                title="Close"
                className="flex size-8 items-center justify-center rounded-full text-lg text-muted hover:bg-surface-2 hover:text-fg"
              >
                «
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 pb-4 [scrollbar-width:thin]">
              {nonEmpty.length === 0 && <p className="px-2 text-sm text-muted">No icons yet — add some in Settings.</p>}
              {nonEmpty.map((group, i) => (
                <div key={i}>
                  {i > 0 && <div aria-hidden className="mx-2 my-2 h-px bg-line" />}
                  <ul className="space-y-0.5">
                    {group.map((app) => (
                      <li key={app.id}>
                        <a
                          href={app.url}
                          {...(/^https?:/i.test(app.url) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          title={app.name}
                          onClick={() => setNarrowOpen(false)}
                          className="group flex items-center gap-3 rounded-xl px-2 py-1.5 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <span className="transition group-active:scale-95">
                            <AppGlyph app={app} size="sm" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
                          {/^https?:/i.test(app.url) && (
                            <span aria-hidden className="text-xs text-muted opacity-0 transition group-hover:opacity-100">
                              ↗
                            </span>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </SidebarContext.Provider>
  );
}

/** The ☰ button that opens and closes the sidebar. */
export function SidebarToggle() {
  const sidebar = useSidebar();
  if (!sidebar) return null;
  return (
    <button
      type="button"
      onClick={sidebar.toggle}
      aria-label={sidebar.open ? "Close apps sidebar" : "Open apps sidebar"}
      aria-expanded={sidebar.open}
      aria-controls="app-sidebar"
      title={sidebar.open ? "Hide apps" : "Show apps"}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-base hover:bg-surface-2"
    >
      ☰
    </button>
  );
}
