"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type Screen = "all" | "day" | "projects";

const CHANNEL = "ss-dashboard";
const PROJECTS_WINDOW = "ss-dashboard-projects";

type ScreenDetails = {
  currentScreen: ScreenInfo;
  screens: ScreenInfo[];
};
type ScreenInfo = { availLeft: number; availTop: number; availWidth: number; availHeight: number };

/** The other monitor, if the browser can tell us (Chrome / Edge ask once for "window management"). */
async function otherScreen(): Promise<ScreenInfo | null> {
  const w = window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> };
  if (!w.getScreenDetails) return null;
  try {
    const details = await Promise.race([
      w.getScreenDetails(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 60_000)),
    ]);
    return details.screens.find((s) => s !== details.currentScreen) ?? null;
  } catch {
    return null; // refused or unanswered: the window stays where it opened, to be dragged across
  }
}

/**
 * Splits the dashboard across two monitors: this window keeps the day
 * (schedule, to-do, notes) and a second window shows the project cards,
 * placed on the other screen where the browser allows it. "One screen"
 * brings everything back into this window and closes the other one.
 */
export function SplitScreens({ screen }: { screen: Screen }) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);

  // The projects window closes itself when the day window rejoins.
  useEffect(() => {
    if (screen !== "projects" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => {
      if (e.data === "join") {
        window.close();
        router.replace("/"); // if the browser won't let a script close this window
      }
    };
    return () => ch.close();
  }, [screen, router]);

  async function split() {
    setBlocked(false);
    // Open first, while the click still counts (a permission prompt would use it
    // up and get the window blocked), then move it to the other monitor.
    const win = window.open(
      "/?screen=projects",
      PROJECTS_WINDOW,
      `popup,width=${Math.round(window.screen.availWidth * 0.9)},height=${Math.round(window.screen.availHeight * 0.9)}`,
    );
    if (!win) {
      setBlocked(true);
      return;
    }
    router.replace("/?screen=day");
    const other = await otherScreen();
    if (other && !win.closed) {
      try {
        win.moveTo(other.availLeft, other.availTop);
        win.resizeTo(other.availWidth, other.availHeight);
      } catch {}
    }
  }

  function join() {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage("join");
      ch.close();
    }
    router.replace("/");
  }

  const btn = "flex h-9 items-center gap-1 rounded-full border border-line bg-surface px-3 text-sm hover:bg-surface-2";
  return (
    <>
      {screen === "all" ? (
        <button type="button" onClick={split} className={btn} title="Split the dashboard across two screens">
          ⧉ <span className="hidden sm:inline">Two screens</span>
        </button>
      ) : (
        <button type="button" onClick={join} className={btn} title="Bring everything back to one screen">
          ▣ <span className="hidden sm:inline">One screen</span>
        </button>
      )}
      {blocked && (
        <span role="alert" className="text-xs text-danger">
          Allow pop-ups for this site, then try again.
        </span>
      )}
    </>
  );
}
