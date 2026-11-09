"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import { TIME_ZONE } from "@/lib/time";
import { ThemeToggle } from "./theme-toggle";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", second: "2-digit" });

export function Header({ showSettings = true }: { showSettings?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted sm:text-base">
          {now ? (
            <>
              {dateFmt.format(now)} · <span className="tabular-nums">{timeFmt.format(now)}</span>
              <span className="ml-1 text-xs">PKT</span>
            </>
          ) : (
            " "
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {showSettings && (
          <Link href="/settings" aria-label="Settings" className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-lg hover:bg-surface-2">
            ⚙︎
          </Link>
        )}
        <form action={signOut}>
          <button className="h-10 rounded-full border border-line bg-surface px-4 text-sm hover:bg-surface-2">Sign out</button>
        </form>
      </div>
    </header>
  );
}
