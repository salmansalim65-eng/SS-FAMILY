import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarWrite } from "@/lib/google";
import { TIME_ZONE } from "@/lib/time";

// A task's time and reminder live in dashboard_task_times (Google Tasks keeps
// dates only). A reminder is also a short event in the owner's primary Google
// Calendar, so the phone's Calendar app rings even with the dashboard closed.

export const REMIND_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440] as const;
const EVENTS = "/calendars/primary/events";
const LENGTH_MIN = 15;

type Row = { task_id: string; due_time: string; remind_minutes: number | null; event_id: string | null };

export type TaskSchedule = { title: string; due: string | null; time: string | null; remind: number | null };

function tableError(error: { code?: string; message: string }) {
  return new Error(error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" ? "Task times aren't set up yet." : error.message);
}

async function row(db: SupabaseClient, taskId: string): Promise<Row | null> {
  const { data, error } = await db.from("dashboard_task_times").select("task_id, due_time, remind_minutes, event_id").eq("task_id", taskId).maybeSingle();
  if (error) throw tableError(error);
  return data as Row | null;
}

/** "2026-11-09", "15:30", +15 → "2026-11-09T15:45:00" (wall-clock, no zone). */
function shift(date: string, time: string, minutes: number) {
  const t = new Date(`${date}T${time}:00Z`);
  t.setUTCMinutes(t.getUTCMinutes() + minutes);
  return t.toISOString().slice(0, 19);
}

function eventBody(taskId: string, s: { title: string; due: string; time: string; remind: number }) {
  return {
    summary: `⏰ ${s.title}`,
    description: "Task reminder from SS Dashboard.",
    start: { dateTime: `${s.due}T${s.time}:00`, timeZone: TIME_ZONE },
    end: { dateTime: shift(s.due, s.time, LENGTH_MIN), timeZone: TIME_ZONE },
    transparency: "transparent",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: s.remind }] },
    extendedProperties: { private: { ssDashboardTask: taskId } },
  };
}

/** Creates, moves or removes the reminder event; returns the event id to keep. */
async function syncEvent(db: SupabaseClient, taskId: string, eventId: string | null, s: TaskSchedule): Promise<string | null> {
  if (s.due && s.time && s.remind !== null) {
    const body = eventBody(taskId, { title: s.title, due: s.due, time: s.time, remind: s.remind });
    if (eventId) {
      const updated = await calendarWrite<{ id: string }>(db, "PATCH", `${EVENTS}/${encodeURIComponent(eventId)}`, body);
      if (updated) return eventId;
    }
    const created = await calendarWrite<{ id: string }>(db, "POST", EVENTS, body);
    return created?.id ?? null;
  }
  if (eventId) await calendarWrite(db, "DELETE", `${EVENTS}/${encodeURIComponent(eventId)}`);
  return null;
}

/** Saves a task's time and reminder (null time clears both) and keeps its Calendar event in step. */
export async function saveTaskSchedule(db: SupabaseClient, taskId: string, s: TaskSchedule) {
  const before = await row(db, taskId);
  const time = s.due ? s.time : null;
  const remind = time ? s.remind : null;
  const eventId = await syncEvent(db, taskId, before?.event_id ?? null, { ...s, time, remind });
  if (!time) {
    if (before) {
      const { error } = await db.from("dashboard_task_times").delete().eq("task_id", taskId);
      if (error) throw tableError(error);
    }
    return;
  }
  const { error } = await db
    .from("dashboard_task_times")
    .upsert({ task_id: taskId, due_time: time, remind_minutes: remind, event_id: eventId });
  if (error) throw tableError(error);
}

/** Done: the reminder event goes. Undone: it comes back, if the task still has one. */
export async function taskDoneChanged(db: SupabaseClient, taskId: string, done: boolean, title: string, due: string | null) {
  const r = await row(db, taskId).catch(() => null);
  if (!r) return;
  if (done) {
    if (!r.event_id) return;
    await syncEvent(db, taskId, r.event_id, { title, due: null, time: null, remind: null });
    await db.from("dashboard_task_times").update({ event_id: null }).eq("task_id", taskId);
  } else if (r.remind_minutes !== null && due) {
    const eventId = await syncEvent(db, taskId, r.event_id, { title, due, time: r.due_time.slice(0, 5), remind: r.remind_minutes });
    await db.from("dashboard_task_times").update({ event_id: eventId }).eq("task_id", taskId);
  }
}

/** Deleted task: its reminder event and saved time go too. */
export async function forgetTask(db: SupabaseClient, taskId: string) {
  const r = await row(db, taskId).catch(() => null);
  if (!r) return;
  if (r.event_id) await calendarWrite(db, "DELETE", `${EVENTS}/${encodeURIComponent(r.event_id)}`).catch(() => null);
  await db.from("dashboard_task_times").delete().eq("task_id", taskId);
}
