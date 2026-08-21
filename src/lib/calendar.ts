import { addDays, format, parseISO } from 'date-fns'
import { supabase } from './supabase'
import type { Guest } from './types'

/**
 * Google Calendar integration.
 *
 * The real integration lives in the `google-calendar` edge function, which
 * talks to the Google Calendar API over OAuth2 and sets a reminder 3 days
 * before arrival. When Google credentials are not configured the function
 * reports back `configured: false` and we fall back to two things that need no
 * setup at all: a one-click "Add to Google Calendar" URL, and an .ics file that
 * imports into Google Calendar, Apple Calendar or Outlook.
 */

const REMINDER_DAYS_BEFORE = 3

function stamp(date: Date): string {
  return format(date, 'yyyyMMdd')
}

export function eventTitle(guest: Guest): string {
  return `Guest arrival: ${guest.name} (${guest.total_guests} pax)`
}

export function eventDescription(guest: Guest): string {
  const lines = [
    `${guest.name} arriving from ${guest.origin_city || 'Pakistan'}.`,
    `Guests: ${guest.total_guests} total - ${guest.male_count} male, ${guest.female_count} female.`,
    guest.relationship ? `Relationship: ${guest.relationship}` : null,
    guest.room ? `Room: ${guest.room}` : null,
    guest.special_needs ? `Special needs: ${guest.special_needs}` : null,
    guest.phone ? `Phone: ${guest.phone}` : null,
    '',
    'Added by the SS Family guest planner.',
  ]
  return lines.filter(Boolean).join('\n')
}

/** All-day event spanning the stay. Google treats DTEND as exclusive. */
function eventRange(guest: Guest): { start: Date; end: Date } {
  const start = parseISO(guest.arrival_date)
  const end = guest.departure_date ? addDays(parseISO(guest.departure_date), 1) : addDays(start, 1)
  return { start, end }
}

export function googleCalendarUrl(guest: Guest): string {
  const { start, end } = eventRange(guest)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(guest),
    dates: `${stamp(start)}/${stamp(end)}`,
    details: eventDescription(guest),
    location: guest.room || 'Home',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function buildIcs(guest: Guest): string {
  const { start, end } = eventRange(guest)
  const now = format(new Date(), "yyyyMMdd'T'HHmmss'Z'")

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SS Family//Guest Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:guest-${guest.id}@ssfamily`,
    `DTSTAMP:${now}`,
    `DTSTART;VALUE=DATE:${stamp(start)}`,
    `DTEND;VALUE=DATE:${stamp(end)}`,
    `SUMMARY:${icsEscape(eventTitle(guest))}`,
    `DESCRIPTION:${icsEscape(eventDescription(guest))}`,
    `LOCATION:${icsEscape(guest.room || 'Home')}`,
    'BEGIN:VALARM',
    `TRIGGER:-P${REMINDER_DAYS_BEFORE}D`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`${guest.name} arrives in ${REMINDER_DAYS_BEFORE} days`)}`,
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
  link.download = `${guest.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}-arrival.ics`
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
 * Ask the edge function to create the real calendar event. Never throws: a
 * calendar hiccup must not stop a guest from being saved.
 */
export async function syncGuestToGoogleCalendar(guest: Guest): Promise<CalendarSyncResult> {
  try {
    const { data, error } = await supabase.functions.invoke('google-calendar', {
      body: {
        guestId: guest.id,
        summary: eventTitle(guest),
        description: eventDescription(guest),
        location: guest.room || 'Home',
        startDate: guest.arrival_date,
        endDate: guest.departure_date,
        reminderDaysBefore: REMINDER_DAYS_BEFORE,
      },
    })

    if (error) {
      return { configured: false, message: 'Google Calendar is not connected yet.' }
    }

    const result = data as CalendarSyncResult
    if (!result?.configured) {
      return {
        configured: false,
        message: result?.message || 'Google Calendar is not connected yet.',
      }
    }

    return result
  } catch {
    return { configured: false, message: 'Google Calendar is not reachable.' }
  }
}
