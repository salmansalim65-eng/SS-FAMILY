"use client";

import Link from "next/link";
import { useState } from "react";
import { TIME_ZONE } from "@/lib/time";

function withParams(src: string, mode: "AGENDA" | "WEEK" | "MONTH") {
  const url = new URL(src);
  url.searchParams.set("mode", mode);
  url.searchParams.set("ctz", TIME_ZONE);
  return url.toString();
}

export function CalendarEmbed({ src }: { src: string | null }) {
  const [mode, setMode] = useState<"AGENDA" | "WEEK" | "MONTH">("AGENDA");

  if (!src) {
    return (
      <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
        <p className="font-medium">Google Calendar</p>
        <p className="text-sm text-muted">Add your calendar’s embed URL to show it here.</p>
        <Link href="/settings#general" className="mt-1 text-sm font-medium text-accent">Open Settings →</Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="text-sm font-medium">Google Calendar</p>
        <div className="flex rounded-full bg-surface-2 p-0.5 text-xs">
          {(["AGENDA", "WEEK", "MONTH"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-2.5 py-1 capitalize ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {m.toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      {/* Google renders its own light theme; this only frames it. */}
      <iframe
        key={mode}
        title="Google Calendar"
        src={withParams(src, mode)}
        className="h-[420px] w-full bg-white sm:h-[520px]"
        loading="lazy"
      />
    </div>
  );
}
