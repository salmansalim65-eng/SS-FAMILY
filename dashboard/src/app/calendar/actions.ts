"use server";

import { createEvent, GoogleNeedsReconnect, GoogleNotConnected } from "@/lib/google";
import { requireOwner } from "@/lib/supabase/server";

export type EventResult = { ok: true } | { ok: false; error: string; reconnect?: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function text(form: FormData, name: string, max: number) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

/** Adds an event to one of the owner's Google calendars. */
export async function addCalendarEvent(form: FormData): Promise<EventResult> {
  try {
    const { supabase } = await requireOwner();
    const title = text(form, "title", 300);
    const calendarId = text(form, "calendarId", 300) || "primary";
    const date = text(form, "date", 10);
    const allDay = form.get("allDay") === "on";
    if (!title) return { ok: false, error: "Add a title." };
    if (!DATE.test(date)) return { ok: false, error: "Pick a date." };
    const common = { calendarId, title, location: text(form, "location", 500), description: text(form, "description", 4000) };

    if (allDay) {
      const endDate = text(form, "endDate", 10) || date;
      if (!DATE.test(endDate) || endDate < date) return { ok: false, error: "The end date can't be before the start date." };
      await createEvent(supabase, { ...common, allDay: true, startDate: date, endDate });
    } else {
      const start = text(form, "startTime", 5);
      const end = text(form, "endTime", 5);
      if (!TIME.test(start) || !TIME.test(end)) return { ok: false, error: "Pick a start and end time." };
      if (end === start) return { ok: false, error: "The end time must be after the start time." };
      // An end time earlier than the start means it runs past midnight.
      const endDay = end < start ? nextDay(date) : date;
      await createEvent(supabase, { ...common, allDay: false, start: `${date}T${start}`, end: `${endDay}T${end}` });
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof GoogleNeedsReconnect || e instanceof GoogleNotConnected) {
      return { ok: false, error: "Reconnect Google Calendar in Settings to allow adding events.", reconnect: true };
    }
    return { ok: false, error: (e instanceof Error && e.message) || "Could not add the event. Please try again." };
  }
}

function nextDay(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
