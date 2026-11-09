"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import { TIME_ZONE } from "@/lib/time";
import { useRouter } from "next/navigation";
import { requestDashboardRefresh } from "@/lib/refresh-event";
import { SplitScreens, type Screen } from "./split-screens";
import { ThemeToggle } from "./theme-toggle";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", second: "2-digit" });

const shortDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const shortTimeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

const roundBtn = "flex size-9 items-center justify-center rounded-full border border-line bg-surface text-base hover:bg-surface-2";

/**
 * The bar across the top: app icons (passed as children) on the left, the
 * Karachi clock and the theme / settings / sign-out buttons on the right.
 * On phones the clock and buttons sit above the icons.
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
    <div className="flex items-center gap-1.5">
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
        <button className="h-9 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-sm hover:bg-surface-2">Sign out</button>
      </form>
    </div>
  );

  return (
    <header className="sticky top-0 z-30 -mx-4 bg-bg/80 px-4 pb-2 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="overflow-hidden rounded-3xl border border-line bg-[linear-gradient(120deg,color-mix(in_srgb,var(--accent)_10%,var(--surface)),var(--surface)_55%)] shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-2 md:hidden">
          <p className="truncate text-xs text-muted">
            {now ? (
              <>
                {shortDateFmt.format(now)} · <span className="tabular-nums">{shortTimeFmt.format(now)}</span>
              </>
            ) : (
              " "
            )}
          </p>
          {controls}
        </div>
        <div className="flex items-center gap-4 px-3 py-3 sm:px-4">
          <nav aria-label="Apps" className="min-w-0 flex-1 md:overflow-x-auto md:[scrollbar-width:none]">
            {children}
          </nav>
          <div className="hidden shrink-0 flex-col items-end gap-2 border-l border-line pl-4 md:flex">
            <p className="text-right text-xs leading-tight text-muted">
              {now ? (
                <>
                  <span className="block">{dateFmt.format(now)}</span>
                  <span className="text-lg font-semibold tabular-nums text-fg">{timeFmt.format(now)}</span>{" "}
                  <span className="text-[10px]">PKT</span>
                </>
              ) : (
                " "
              )}
            </p>
            {controls}
          </div>
        </div>
      </div>
    </header>
  );
}
