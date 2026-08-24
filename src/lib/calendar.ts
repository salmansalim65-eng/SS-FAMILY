import { addDays, format, parseISO } from 'date-fns'
import { supabase } from './supabase'
import type { Guest } from './types'

/**
 * Google Calendar integration.
 *
 * A guest is saved first and synced second, so a calendar problem can never
 * stop a visit being recorded. The real work happens in the `google-calendar`
 * edge function; when Google is not connected it replies { configured: false }
 * and the guest card falls back to a one-click "Add to Calendar" link and an
 * .ics download that carry the same reminder.
 *
 * The two guest types produce different events:
 *
 *   staying  all-day event spanning arrival → departure, reminder 3 days before
 *   dinner   timed evening event on one date,            reminder 1 day before
 */

export const TIME_ZONE = 'Asia/Riyadh'
export const DEFAULT_DINNER_TIME = '20:00'
const DINNER_HOURS = 3

export function reminderDaysFor(guest: Guest): number {
  return guest.guest_type === 'dinner' ? 1 : 3
}

function stamp(date: Date): string {
  return format(date, 'yyyyMMdd')
}

/** Google's basic format for timed events: 20260824T200000 */
function stampTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(/:/g, '').padEnd(6, '0')}`
}

function dinnerTime(guest: Guest): string {
  return (guest.event_time ?? DEFAULT_DINNER_TIME).slice(0, 5)
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number)
  const end = (h + hours) % 24
  return `${String(end).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function eventTitle(guest: Guest): string {
  return guest.guest_type === 'dinner'
    ? `Dinner guests: ${guest.name} (${guest.total_guests} pax)`
    : `Guest arrival: ${guest.name} (${guest.total_guests} pax)`
}

export function eventDescription(guest: Guest): string {
  const lines = [
    guest.guest_type === 'dinner'
      ? `${guest.name} joining the family for dinner.`
      : `${guest.name} arriving from ${guest.origin_city || 'Pakistan'}.`,
    `Guests: ${guest.total_guests} total - ${guest.male_count} male, ${guest.female_count} female.`,
    guest.relationship ? `Relationship: ${guest.relationship}` : null,
    guest.guest_type === 'staying' && guest.room ? `Room: ${guest.room}` : null,
    guest.special_needs ? `Special needs: ${guest.special_needs}` : null,
    guest.phone ? `Phone: ${guest.phone}` : null,
    '',
    'Added by the SS Family guest planner.',
  ]
  return lines.filter(Boolean).join('\n')
}

/** All-day events use an exclusive end date; timed ones use real times. */
function eventRange(guest: Guest): { start: Date; end: Date } {
  const start = parseISO(guest.arrival_date)
  const end = guest.departure_date ? addDays(parseISO(guest.departure_date), 1) : addDays(start, 1)
  return { start, end }
}

export function googleCalendarUrl(guest: Guest): string {
  let dates: string

  if (guest.guest_type === 'dinner') {
    const from = dinnerTime(guest)
    const to = addHours(from, DINNER_HOURS)
    dates = `${stampTime(guest.arrival_date, from)}/${stampTime(guest.arrival_date, to)}`
  } else {
    const { start, end } = eventRange(guest)
    dates = `${stamp(start)}/${stamp(end)}`
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(guest),
    dates,
    details: eventDescription(guest),
    location: (guest.guest_type === 'staying' ? guest.room : null) || 'Home',
    ctz: TIME_ZONE,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

export function buildIcs(guest: Guest): string {
  const now = format(new Date(), "yyyyMMdd'T'HHmmss'Z'")
  const reminderDays = reminderDaysFor(guest)

  let start: string
  let end: string

  if (guest.guest_type === 'dinner') {
    const from = dinnerTime(guest)
    start = `DTSTART;TZID=${TIME_ZONE}:${stampTime(guest.arrival_date, from)}`
    end = `DTEND;TZID=${TIME_ZONE}:${stampTime(guest.arrival_date, addHours(from, DINNER_HOURS))}`
  } else {
    const range = eventRange(guest)
    start = `DTSTART;VALUE=DATE:${stamp(range.start)}`
    end = `DTEND;VALUE=DATE:${stamp(range.end)}`
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SS Family//Guest Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:guest-${guest.id}@ssfamily`,
    `DTSTAMP:${now}`,
    start,
    end,
    `SUMMARY:${icsEscape(eventTitle(guest))}`,
    `DESCRIPTION:${icsEscape(eventDescription(guest))}`,
    `LOCATION:${icsEscape((guest.guest_type === 'staying' ? guest.room : null) || 'Home')}`,
    'BEGIN:VALARM',
    `TRIGGER:-P${reminderDays}D`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(
      guest.guest_type === 'dinner'
        ? `${guest.name} coming for dinner in ${reminderDays} day(s)`
        : `${guest.name} arrives in ${reminderDays} days`,
    )}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadIcs(guest: Guest): void {
  const blob = new Blob([buildIcs(guest)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const safe = guest.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
  link.download = `${safe}-${guest.guest_type}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export interface CalendarSyncResult {
  configured: boolean
  eventId?: string
  htmlLink?: string
  message: string
}

/**
 * Create or update the guest's event and store the id back on the row.
 * Never throws — a calendar hiccup must not surface as a failed save.
 */
export async function syncGuestToGoogleCalendar(guest: Guest): Promise<CalendarSyncResult> {
  try {
    const { data, error } = await supabase.functions.invoke('google-calendar', {
      body: {
        action: 'upsert',
        guestId: guest.id,
        guestType: guest.guest_type,
        summary: eventTitle(guest),
        description: eventDescription(guest),
        location: (guest.guest_type === 'staying' ? guest.room : null) || 'Home',
        startDate: guest.arrival_date,
        endDate: guest.departure_date,
        startTime: guest.guest_type === 'dinner' ? dinnerTime(guest) : null,
        durationHours: DINNER_HOURS,
        timeZone: TIME_ZONE,
        reminderDaysBefore: reminderDaysFor(guest),
        existingEventId: guest.google_calendar_event_id,
      },
    })

    if (error) return { configured: false, message: 'Google Calendar is not connected yet.' }

    const result = data as CalendarSyncResult
    if (!result?.configured) {
      return {
        configured: false,
        message: result?.message || 'Google Calendar is not connected yet.',
      }
    }

    // Remember the event so later edits update it instead of duplicating.
    if (result.eventId && result.eventId !== guest.google_calendar_event_id) {
      await supabase
        .from('guests')
        .update({
          google_calendar_event_id: result.eventId,
          google_calendar_html_link: result.htmlLink ?? null,
        })
        .eq('id', guest.id)
    }

    return result
  } catch {
    return { configured: false, message: 'Google Calendar is not reachable.' }
  }
}

/** Best effort: remove the event when a guest is deleted. */
export async function removeGuestFromGoogleCalendar(eventId: string | null): Promise<void> {
  if (!eventId) return
  try {
    await supabase.functions.invoke('google-calendar', {
      body: { action: 'delete', existingEventId: eventId },
    })
  } catch {
    /* the guest is gone either way */
  }
}
