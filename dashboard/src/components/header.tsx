"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import { TIME_ZONE } from "@/lib/time";
import { useRouter } from "next/navigation";
import { requestDashboardRefresh } from "@/lib/refresh-event";
import { SidebarToggle } from "./app-sidebar";
import { InboxBell } from "./inbox";
import { SplitScreens, type Screen } from "./split-screens";
import { ThemeToggle } from "./theme-toggle";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const shortDateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const shortTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

const roundBtn =
  "flex size-9 items-center justify-center rounded-full border border-line bg-surface text-base hover:bg-surface-2";

/**
 * A thin coloured strip across the top: the sidebar's ☰ switch and the
 * title, the Karachi date and clock, and the refresh / theme / settings /
 * sign-out buttons.
 */
const STRIP_KEY = "dashboard.stripTheme";
const STRIPS = [
  { key: "ocean", name: "Ocean", bg: "linear-gradient(90deg,#0f766e,#0891b2,#2563eb)" },
  { key: "classic", name: "Classic", bg: "linear-gradient(90deg,#4f46e5,#7c3aed,#0284c7)" },
  { key: "sunset", name: "Sunset", bg: "linear-gradient(90deg,#f97316,#ec4899,#8b5cf6)" },
  { key: "emerald", name: "Emerald", bg: "linear-gradient(90deg,#047857,#10b981,#84cc16)" },
  { key: "midnight", name: "Midnight", bg: "linear-gradient(90deg,#0f172a,#1e3a8a,#4338ca)" },
  { key: "gold", name: "Royal Gold", bg: "linear-gradient(90deg,#78350f,#b45309,#f59e0b)" },
  { key: "berry", name: "Berry", bg: "linear-gradient(90deg,#be185d,#9333ea,#4f46e5)" },
  { key: "aurora", name: "Aurora", bg: "linear-gradient(90deg,#16a34a,#06b6d4,#8b5cf6)" },
  { key: "coral", name: "Coral", bg: "linear-gradient(90deg,#dc2626,#f97316,#f59e0b)" },
  { key: "mint", name: "Mint", bg: "linear-gradient(90deg,#0d9488,#14b8a6,#22d3ee)" },
  { key: "graphite", name: "Graphite", bg: "linear-gradient(90deg,#1f2937,#374151,#4b5563)" },
] as const;

export function Header({
  showSettings = true,
  screen = "all",
  children,
}: {
  showSettings?: boolean;
  screen?: Screen;
  children?: React.ReactNode;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // The strip's colours: Ocean by default, others from 🎨, remembered in this browser.
  const [strip, setStrip] = useState<(typeof STRIPS)[number]>(STRIPS[0]);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    try {
      const saved = STRIPS.find((x) => x.key === localStorage.getItem(STRIP_KEY));
      if (saved) setStrip(saved);
    } catch {}
  }, []);
  function pickStrip(x: (typeof STRIPS)[number]) {
    setStrip(x);
    setPicking(false);
    try {
      localStorage.setItem(STRIP_KEY, x.key);
    } catch {}
  }

  const router = useRouter();
  const [spinning, setSpinning] = useState(false);
  // Reloads the panels in place and the server-rendered parts (icons, cards' setup).
  function refreshAll() {
    setSpinning(true);
    requestDashboardRefresh();
    router.refresh();
    setTimeout(() => setSpinning(false), 1200);
  }

  const controls = (
    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
      <InboxBell />
      <button type="button" onClick={refreshAll} aria-label="Refresh dashboard" title="Refresh everything" className={roundBtn}>
        <span aria-hidden className={spinning ? "animate-spin" : ""}>
          ↻
        </span>
      </button>
      <div className="hidden items-center gap-1.5 lg:flex">
        <SplitScreens screen={screen} />
      </div>
      <ThemeToggle />
      {showSettings && (
        <Link href="/settings" aria-label="Settings" className={roundBtn}>
          ⚙︎
        </Link>
      )}
      <form action={signOut}>
        <button
          aria-label="Sign out"
          title="Sign out"
          className="flex h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-full border border-line bg-surface text-sm hover:bg-surface-2 sm:px-3"
        >
          <span aria-hidden className="sm:hidden">
            ⏻
          </span>
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </form>
    </div>
  );

  return (
    <header className="sticky top-0 z-30 -mx-4 bg-bg/80 px-4 pb-2 pt-2 backdrop-blur sm:-mx-6 sm:px-6">
      {/* A thin coloured strip; the shared buttons are re-tinted to sit on it. */}
      <div style={{ backgroundImage: strip.bg }} className="relative flex items-center gap-2 rounded-2xl px-2 py-1 text-white shadow-sm sm:gap-3 sm:px-3 [&_a]:border-white/25 [&_a]:bg-white/15 [&_a:hover]:bg-white/25 [&_button]:border-white/25 [&_button]:bg-white/15 [&_button]:text-white [&_button:hover]:bg-white/25">
        <SidebarToggle />
        <div className="min-w-0 flex-1">
          {children ?? <p className="truncate text-sm font-semibold">SS Dashboard</p>}
        </div>
        <p className="shrink-0 truncate text-xs text-white/85 sm:text-sm" suppressHydrationWarning>
          {now ? (
            <>
              <span className="hidden md:inline">{dateFmt.format(now)}</span>
              <span className="hidden sm:inline md:hidden">{shortDateFmt.format(now)}</span>
              <span className="mx-1.5 hidden text-white/50 sm:inline">·</span>
              <span className="font-semibold tabular-nums text-white">
                <span className="hidden md:inline">{timeFmt.format(now)}</span>
                <span className="md:hidden">{shortTimeFmt.format(now)}</span>
              </span>
              <span className="ml-1 hidden text-[10px] text-white/70 sm:inline">PKT</span>
            </>
          ) : (
            "\u00a0"
          )}
        </p>
        <span aria-hidden className="hidden h-6 w-px bg-white/30 sm:block" />
        <button
          type="button"
          onClick={() => setPicking((x) => !x)}
          aria-label="Strip colours"
          aria-expanded={picking}
          title="Strip colours"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm"
        >
          🎨
        </button>
        {controls}
        {picking && (
          <div className="absolute right-2 top-full z-40 mt-2 w-72 rounded-2xl border border-line bg-surface p-3 text-fg shadow-xl" role="dialog" aria-label="Strip colours">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Strip colour</p>
            <div className="grid grid-cols-2 gap-2">
              {STRIPS.map((x) => (
                <span
                  key={x.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => pickStrip(x)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pickStrip(x)}
                  className={`cursor-pointer rounded-xl p-1 text-left text-xs ${strip.key === x.key ? "ring-2 ring-accent" : "hover:bg-surface-2"}`}
                >
                  <span className="block h-6 rounded-lg" style={{ backgroundImage: x.bg }} />
                  <span className="mt-1 block px-0.5 font-medium">{x.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
