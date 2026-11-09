"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import { TIME_ZONE } from "@/lib/time";
import { useRouter } from "next/navigation";
import { requestDashboardRefresh } from "@/lib/refresh-event";
import { SidebarToggle } from "./app-sidebar";
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
      <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-600 px-2 py-1 text-white shadow-sm sm:gap-3 sm:px-3 [&_a]:border-white/25 [&_a]:bg-white/15 [&_a:hover]:bg-white/25 [&_button]:border-white/25 [&_button]:bg-white/15 [&_button]:text-white [&_button:hover]:bg-white/25">
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
        {controls}
      </div>
    </header>
  );
}
