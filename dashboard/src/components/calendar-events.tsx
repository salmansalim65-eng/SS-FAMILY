"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addCalendarEvent } from "@/app/calendar/actions";
import { addDays, karachiToday, type Ymd } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

const REFRESH_MS = 10 * 60 * 1000;
const SCHEDULE_DAYS = 14;
const HOUR_PX = 48;
const VIEW_KEY = "dashboard.calendarView";

type View = "week" | "schedule";
type Calendar = { id: string; name: string; color: string | null };
type Data = { key: string; events: CalendarEvent[]; calendars: Calendar[]; canWrite: boolean };
type Draft = { date: string; start: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymdKey = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;
const utc = ({ y, m, d }: Ymd) => new Date(Date.UTC(y, m - 1, d));
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
const weekdayFmt = fmt({ weekday: "short" });
const monthFmt = fmt({ month: "long" });
const monthShortFmt = fmt({ month: "short" });

/** Monday of the week containing `day`. */
function weekStart(day: Ymd): Ymd {
  return addDays(day, -((utc(day).getUTCDay() + 6) % 7));
}

function rangeLabel(from: Ymd, to: Ymd) {
  if (from.m === to.m) return `${monthFmt.format(utc(from))} ${from.y}`;
  const end = `${monthShortFmt.format(utc(to))} ${to.y}`;
  return from.y === to.y ? `${monthShortFmt.format(utc(from))} – ${end}` : `${monthShortFmt.format(utc(from))} ${from.y} – ${end}`;
}

// Events come back in Asia/Karachi wall-clock time, so the strings can be
// read directly: the first 10 characters are the date, 11–16 the time.
const datePart = (s: string) => s.slice(0, 10);
const minutesOf = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));

function clock(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)}` : `${h12}`;
}

function timeRange(e: CalendarEvent) {
  if (e.allDay) return "All day";
  const s = minutesOf(e.start);
  const end = minutesOf(e.end);
  const ap = (min: number) => (Math.floor(min / 60) % 24 < 12 ? "am" : "pm");
  const sameHalf = datePart(e.start) === datePart(e.end) && ap(s) === ap(end);
  return `${clock(s)}${sameHalf ? "" : ap(s)} – ${clock(end)}${ap(end)}`;
}

/** Does the event cover any part of `day` (YYYY-MM-DD)? All-day end dates are exclusive. */
function onDay(e: CalendarEvent, day: string) {
  const s = datePart(e.start);
  const end = datePart(e.end);
  if (e.allDay) return s <= day && day < end;
  return s <= day && (day < end || (day === end && (s < day ? minutesOf(e.end) > 0 : true)));
}

/** Dark or light text, whichever reads better on `hex`. */
function textOn(hex: string | null) {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.65 ? "#1f2937" : "#fff";
}

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function CalendarEvents({ fallback }: { fallback?: React.ReactNode }) {
  const now = useNow();
  const today = karachiToday(now);
  const todayKey = ymdKey(today);

  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<Ymd>(() => weekStart(karachiToday()));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Remembered per browser; phones start on the schedule list.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {}
    if (saved === "week" || saved === "schedule") setView(saved);
    else if (window.matchMedia("(max-width: 767px)").matches) setView("schedule");
  }, []);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const from = view === "week" ? anchor : today;
  const days = view === "week" ? 7 : SCHEDULE_DAYS;
  const key = `${ymdKey(from)}/${days}`;

  const latest = useRef(key);
  latest.current = key;

  const load = useCallback(async () => {
    const requested = key;
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar?from=${requested.replace("/", "&days=")}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (latest.current !== requested) return;
      setConnected(body.connected);
      setData({ key: requested, events: body.events ?? [], calendars: body.calendars ?? [], canWrite: !!body.canWrite });
      setError(null);
    } catch (e) {
      if (latest.current === requested) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (latest.current === requested) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!connected) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Google Calendar</p>
            <p className="text-sm text-muted">Connect once to see your week and upcoming schedule here.</p>
          </div>
          <a href="/api/google/connect" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            Connect Google Calendar
          </a>
        </div>
        {fallback}
      </div>
    );
  }

  const events = data?.events ?? [];
  const stale = loading && data?.key !== key;
  const weekEnd = addDays(anchor, 6);

  return (
    <section className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {view === "week" && (
          <>
            <button
              type="button"
              onClick={() => setAnchor(weekStart(today))}
              className="rounded-full border border-line px-3 py-1 text-sm hover:bg-surface-2"
            >
              Today
            </button>
            <div className="flex">
              <NavButton label="Previous week" onClick={() => setAnchor((a) => addDays(a, -7))}>
                ‹
              </NavButton>
              <NavButton label="Next week" onClick={() => setAnchor((a) => addDays(a, 7))}>
                ›
              </NavButton>
            </div>
          </>
        )}
        <h3 className="font-medium">{view === "week" ? rangeLabel(anchor, weekEnd) : "Upcoming"}</h3>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const hour = Math.min(Math.floor(minutesNow(now) / 60) + 1, 23);
              setDraft({ date: todayKey, start: `${pad(hour)}:00` });
            }}
            className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-white hover:opacity-90"
          >
            + Event
          </button>
          <button type="button" onClick={load} className="px-1 text-xs text-muted hover:text-fg" aria-label="Refresh calendar">
            ↻
          </button>
          <div className="flex rounded-full border border-line p-0.5 text-xs" role="tablist" aria-label="Calendar view">
            {(["week", "schedule"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => chooseView(v)}
                className={`rounded-full px-3 py-1 capitalize ${view === v ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          Couldn’t load the calendar: {error}
        </p>
      )}

      {!data && loading ? (
        <Skeleton />
      ) : (
        <div className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}>
          {view === "week" ? (
            <WeekView
              start={anchor}
              events={events}
              todayKey={todayKey}
              now={now}
              onPick={(date, minutes) => setDraft({ date, start: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` })}
            />
          ) : (
            <ScheduleView start={today} events={events} todayKey={todayKey} />
          )}
        </div>
      )}

      {draft && (
        <EventDialog
          draft={draft}
          calendars={data?.calendars ?? []}
          canWrite={data?.canWrite ?? true}
          onClose={() => setDraft(null)}
          onSaved={(date) => {
            setDraft(null);
            const day = { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) };
            if (view === "week" && ymdKey(weekStart(day)) !== ymdKey(anchor)) setAnchor(weekStart(day));
            else load();
          }}
        />
      )}
    </section>
  );
}

function minutesNow(now: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now)
    .split(":")
    .map(Number);
  return h * 60 + m;
}

function plusHour(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${pad((h + 1) % 24)}:${pad(m)}`;
}

const field =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function EventDialog({
  draft,
  calendars,
  canWrite,
  onClose,
  onSaved,
}: {
  draft: Draft;
  calendars: Calendar[];
  canWrite: boolean;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(plusHour(draft.start));
  const [error, setError] = useState<{ text: string; reconnect?: boolean } | null>(
    canWrite ? null : { text: "Google Calendar was connected for viewing only. Reconnect it once to allow adding events.", reconnect: true },
  );
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await addCalendarEvent(form);
      if (res.ok) onSaved(String(form.get("date")));
      else setError({ text: res.error, reconnect: res.reconnect });
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-event-title"
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 id="new-event-title" className="font-medium">New event</h3>
          <button type="button" onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>

        <input ref={titleRef} name="title" required maxLength={300} placeholder="Add title" className={`${field} text-base`} />

        <div className="flex flex-wrap items-center gap-2">
          <input type="date" name="date" required defaultValue={draft.date} className={`${field} w-auto flex-1`} aria-label="Date" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>
        </div>

        {allDay ? (
          <label className="block text-xs text-muted">
            Until (optional)
            <input type="date" name="endDate" className={`${field} mt-1`} />
          </label>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="time"
              name="startTime"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (e.target.value) setEnd(plusHour(e.target.value));
              }}
              className={field}
              aria-label="Start time"
            />
            <span className="text-muted">–</span>
            <input type="time" name="endTime" required value={end} onChange={(e) => setEnd(e.target.value)} className={field} aria-label="End time" />
          </div>
        )}

        {calendars.length > 1 ? (
          <select name="calendarId" defaultValue={calendars[0]?.id} className={field} aria-label="Calendar">
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="calendarId" value={calendars[0]?.id ?? "primary"} />
        )}

        <input name="location" maxLength={500} placeholder="Location (optional)" className={field} />
        <textarea name="description" maxLength={4000} rows={2} placeholder="Notes (optional)" className={field} />

        {error && (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error.text}{" "}
            {error.reconnect && (
              <a href="/api/google/connect" className="font-medium underline">
                Reconnect now
              </a>
            )}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-surface-2">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center rounded-full text-lg leading-none text-muted hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Week: a column per day, hours down the side, events placed by time.
// ---------------------------------------------------------------------------

type Placed = { event: CalendarEvent; top: number; bottom: number; lane: number; lanes: number };

/** Clip timed events to one day and spread overlapping ones side by side. */
function layoutDay(events: CalendarEvent[], day: string): Placed[] {
  const items = events
    .filter((e) => !e.allDay && onDay(e, day))
    .map((event) => {
      const top = datePart(event.start) < day ? 0 : minutesOf(event.start);
      const bottom = datePart(event.end) > day ? 1440 : minutesOf(event.end);
      return { event, top, bottom: Math.max(bottom, top + 20), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const finish = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    cluster.forEach((p) => (p.lanes = lanes));
  };
  for (const item of items) {
    if (item.top >= clusterEnd) {
      finish();
      cluster = [];
    }
    const laneEnds = cluster.reduce<number[]>((acc, p) => ((acc[p.lane] = Math.max(acc[p.lane] ?? 0, p.bottom)), acc), []);
    const free = laneEnds.findIndex((end) => end <= item.top);
    item.lane = free === -1 ? laneEnds.length : free;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  finish();
  return items;
}

function WeekView({
  start,
  events,
  todayKey,
  now,
  onPick,
}: {
  start: Ymd;
  events: CalendarEvent[];
  todayKey: string;
  now: Date;
  onPick: (date: string, minutes: number) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const keys = days.map(ymdKey);
  const allDay = keys.map((k) => events.filter((e) => e.allDay && onDay(e, k)));
  const hasAllDay = allDay.some((list) => list.length > 0);
  const nowMinutes = minutesNow(now);

  // Start scrolled to the morning (or an hour before now, if that's later).
  const scroller = useRef<HTMLDivElement>(null);
  const showsToday = keys.includes(todayKey);
  useEffect(() => {
    const hour = showsToday ? Math.max(7, Math.floor(nowMinutes / 60) - 1) : 7;
    scroller.current?.scrollTo({ top: Math.min(hour, 14) * HOUR_PX });
    // Only when the week changes, not every minute.
  }, [start]);

  const cols = "grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]";

  return (
    <div className="-mx-3 overflow-x-auto sm:mx-0">
      <div className="min-w-[640px] px-3 sm:px-0">
        <div className={`${cols} border-b border-line pb-2`}>
          <div className="self-end text-[10px] text-muted">GMT+5</div>
          {days.map((d, i) => {
            const isToday = keys[i] === todayKey;
            return (
              <div key={keys[i]} className="text-center">
                <div className={`text-[11px] font-medium uppercase ${isToday ? "text-accent" : "text-muted"}`}>
                  {weekdayFmt.format(utc(d))}
                </div>
                <div
                  className={`mx-auto mt-0.5 grid size-9 place-items-center rounded-full text-lg ${
                    isToday ? "bg-accent text-white" : ""
                  }`}
                >
                  {d.d}
                </div>
              </div>
            );
          })}
        </div>

        {hasAllDay && (
          <div className={`${cols} border-b border-line py-1`}>
            <div />
            {allDay.map((list, i) => (
              <div key={keys[i]} className="space-y-0.5 px-0.5">
                {list.map((e) => (
                  <EventLink key={e.id} event={e} className="block truncate rounded px-1.5 py-0.5 text-xs font-medium">
                    {e.title}
                  </EventLink>
                ))}
              </div>
            ))}
          </div>
        )}

        <div ref={scroller} className="relative max-h-[560px] overflow-y-auto">
          <div className={cols} style={{ height: 24 * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, h) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10px] text-muted"
                  style={{ top: (h + 1) * HOUR_PX }}
                >
                  {clock((h + 1) * 60)} {h + 1 < 12 ? "AM" : "PM"}
                </span>
              ))}
            </div>
            {keys.map((k) => (
              <div
                key={k}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const y = e.nativeEvent.offsetY;
                  onPick(k, Math.min(Math.floor((y / HOUR_PX) * 2) * 30, 23 * 60));
                }}
                className="relative cursor-pointer border-l border-line"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--line) ${HOUR_PX - 1}px ${HOUR_PX}px)`,
                }}
              >
                {layoutDay(events, k).map(({ event, top, bottom, lane, lanes }) => {
                  const short = bottom - top < 45;
                  return (
                    <EventLink
                      key={event.id}
                      event={event}
                      className="absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight shadow-sm ring-1 ring-surface hover:z-10 hover:brightness-110"
                      style={{
                        top: (top / 60) * HOUR_PX + 1,
                        height: ((bottom - top) / 60) * HOUR_PX - 2,
                        left: `calc(${(lane / lanes) * 100}% + 1px)`,
                        width: `calc(${100 / lanes}% - 3px)`,
                      }}
                    >
                      <span className={short ? "truncate" : "block truncate font-medium"}>{event.title}</span>
                      {short ? (
                        <span className="opacity-80">, {timeRange(event)}</span>
                      ) : (
                        <span className="block truncate opacity-80">{timeRange(event)}</span>
                      )}
                    </EventLink>
                  );
                })}
                {k === todayKey && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMinutes / 60) * HOUR_PX }}>
                    <div className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-red-500" />
                    <div className="h-0.5 bg-red-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule: upcoming days that have something on, like the phone widget.
// ---------------------------------------------------------------------------

function ScheduleView({ start, events, todayKey }: { start: Ymd; events: CalendarEvent[]; todayKey: string }) {
  const days = Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(start, i))
    .map((d) => ({ day: d, key: ymdKey(d), list: events.filter((e) => onDay(e, ymdKey(d))) }))
    .filter((d) => d.list.length > 0);

  if (days.length === 0) return <p className="py-6 text-center text-sm text-muted">Nothing scheduled for the next two weeks.</p>;

  let lastMonth = -1;
  return (
    <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
      {days.map(({ day, key, list }) => {
        const isToday = key === todayKey;
        const monthHeading = day.m !== lastMonth && lastMonth !== -1;
        lastMonth = day.m;
        return (
          <div key={key}>
            {monthHeading && <p className="mb-2 mt-4 text-sm font-semibold">{monthFmt.format(utc(day))}</p>}
            <div className="flex gap-3">
              <div className="w-10 shrink-0 pt-1 text-center">
                <div className={`text-[11px] ${isToday ? "text-accent" : "text-muted"}`}>{weekdayFmt.format(utc(day))}</div>
                <div
                  className={`mx-auto grid size-8 place-items-center rounded-full text-base ${
                    isToday ? "bg-accent font-medium text-white" : ""
                  }`}
                >
                  {day.d}
                </div>
              </div>
              <ul className="min-w-0 flex-1 space-y-1.5">
                {list.map((e) => (
                  <li key={e.id}>
                    <EventLink event={e} className="block rounded-xl px-3 py-2 hover:brightness-110">
                      <span className="block truncate text-sm font-medium">{e.title}</span>
                      <span className="block truncate text-xs opacity-85">
                        {timeRange(e)}
                        {e.location ? ` · ${e.location}` : ""}
                      </span>
                    </EventLink>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventLink({
  event,
  className,
  style,
  children,
}: {
  event: CalendarEvent;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const bg = event.color ?? "#7986cb";
  return (
    <a
      href={event.link ?? "https://calendar.google.com"}
      target="_blank"
      rel="noopener noreferrer"
      title={`${event.title}\n${timeRange(event)}${event.location ? `\n${event.location}` : ""}\n${event.calendar}`}
      className={className}
      style={{ background: bg, color: textOn(bg), ...style }}
    >
      {children}
    </a>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />
      ))}
    </div>
  );
}
