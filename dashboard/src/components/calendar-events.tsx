"use client";

import { useCallback, useEffect, useState } from "react";
import { TIME_ZONE } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

const REFRESH_MS = 10 * 60 * 1000;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "disconnected" }
  | { status: "ready"; events: CalendarEvent[]; updatedAt: Date };

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

// Events come back in TIME_ZONE, so the first 10 characters are the local date.
function eventDay(e: CalendarEvent, today: string) {
  const d = e.start.slice(0, 10);
  return d < today ? today : d; // something that started earlier and is still running
}

function eventTime(e: CalendarEvent) {
  if (e.allDay) return "All day";
  return `${timeFmt.format(new Date(e.start))} – ${timeFmt.format(new Date(e.end))}`;
}

export function CalendarEvents({ fallback }: { fallback?: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState(body.connected ? { status: "ready", events: body.events, updatedAt: new Date() } : { status: "disconnected" });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load" });
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (state.status === "disconnected") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Google Calendar</p>
            <p className="text-sm text-muted">Connect once to see today’s events and the week ahead here.</p>
          </div>
          <a href="/api/google/connect" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Connect Google Calendar
          </a>
        </div>
        {fallback}
      </div>
    );
  }

  const today = dayKey.format(new Date());
  const events = state.status === "ready" ? state.events : [];
  const todays = events.filter((e) => eventDay(e, today) === today);
  const later = events.filter((e) => eventDay(e, today) > today);
  const byDay = later.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    (acc[eventDay(e, today)] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel
        title="Today"
        action={
          <button type="button" onClick={load} className="text-xs text-muted hover:text-fg" aria-label="Refresh calendar">
            ↻ Refresh
          </button>
        }
      >
        {state.status === "loading" ? (
          <Skeleton />
        ) : state.status === "error" ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">Couldn’t load the calendar: {state.message}</p>
        ) : todays.length === 0 ? (
          <p className="text-sm text-muted">Nothing on the calendar today.</p>
        ) : (
          <EventList events={todays} />
        )}
      </Panel>

      <Panel title="Next 7 days">
        {state.status === "loading" ? (
          <Skeleton />
        ) : state.status === "error" ? (
          <p className="text-sm text-muted">—</p>
        ) : later.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled for the rest of the week.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(byDay).map(([day, list]) => (
              <div key={day}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  {dayLabel.format(new Date(`${day}T12:00:00+05:00`))}
                </p>
                <EventList events={list} />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function EventList({ events }: { events: CalendarEvent[] }) {
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li key={e.id}>
          <a
            href={e.link ?? "https://calendar.google.com"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 rounded-xl p-2 hover:bg-surface-2"
          >
            <span className="mt-1 w-1 shrink-0 self-stretch rounded-full" style={{ background: e.color ?? "var(--accent)" }} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{e.title}</span>
              <span className="block truncate text-xs text-muted">
                {eventTime(e)}
                {e.location ? ` · ${e.location}` : ""}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-xl bg-surface-2" />
      ))}
    </div>
  );
}
