// ---------------------------------------------------------------------------
// google-calendar
//
// Creates, updates or deletes the Google Calendar event for a guest visit.
// Two shapes, matching the two kinds of guest:
//
//   staying  all-day event spanning arrival → departure (end date exclusive)
//   dinner   timed event on one date, default 3 hours, in the family time zone
//
// Secrets required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_ID   (optional, defaults to "primary" — set this to the
//                         shared family calendar so everyone sees the event)
//
// With none of them set the function is a well-behaved no-op: it replies
// { configured: false } and the app falls back to an "Add to Calendar" link
// and an .ics download, so nothing in the product breaks.
// ---------------------------------------------------------------------------
import { corsHeaders, json } from './cors.ts'

interface Payload {
  action?: 'upsert' | 'delete'
  guestId?: string
  guestType?: 'staying' | 'dinner'
  summary?: string
  description?: string
  location?: string
  startDate?: string
  endDate?: string | null
  startTime?: string | null
  durationHours?: number
  timeZone?: string
  reminderDaysBefore?: number
  existingEventId?: string | null
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** "20:00" + 3h -> "23:00", clamped inside the same day. */
function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number)
  const end = Math.min(h + hours, 23)
  return `${String(end).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00`
}

async function accessToken(id: string, secret: string, refresh: string): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })

  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error_description || body.error || 'Token exchange failed')
  }
  return body.access_token as string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') || 'primary'

  if (!clientId || !clientSecret || !refreshToken) {
    return json({
      configured: false,
      message:
        'Google Calendar is not connected. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ' +
        'GOOGLE_REFRESH_TOKEN as edge function secrets to enable automatic events.',
    })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return json({ configured: true, error: 'Invalid JSON body' }, 400)
  }

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

  try {
    const token = await accessToken(clientId, clientSecret, refreshToken)

    // ------------------------------------------------------------- delete
    if (payload.action === 'delete') {
      if (!payload.existingEventId) return json({ configured: true, ok: true })

      const response = await fetch(`${base}/${encodeURIComponent(payload.existingEventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      // 404/410 mean it is already gone, which is the outcome we wanted.
      if (!response.ok && ![404, 410].includes(response.status)) {
        return json({ configured: true, error: 'Could not delete the event.' }, 502)
      }
      return json({ configured: true, ok: true, message: 'Calendar event removed.' })
    }

    // ------------------------------------------------------------- upsert
    if (!payload.summary || !payload.startDate) {
      return json({ configured: true, error: 'summary and startDate are required' }, 400)
    }

    const reminderDays = payload.reminderDaysBefore ?? 3
    const reminderMinutes = reminderDays * 24 * 60
    const timeZone = payload.timeZone || 'Asia/Riyadh'

    // A dinner is a timed event; a stay is an all-day span.
    const timed = payload.guestType === 'dinner' && !!payload.startTime
    const when = timed
      ? {
          start: {
            dateTime: `${payload.startDate}T${payload.startTime}:00`,
            timeZone,
          },
          end: {
            dateTime: `${payload.startDate}T${addHours(
              payload.startTime!,
              payload.durationHours ?? 3,
            )}`,
            timeZone,
          },
        }
      : {
          start: { date: payload.startDate },
          end: { date: addDays(payload.endDate || payload.startDate, 1) },
        }

    const event = {
      ...when,
      summary: payload.summary,
      description: payload.description ?? '',
      location: payload.location ?? '',
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: reminderMinutes },
          { method: 'email', minutes: reminderMinutes },
        ],
      },
      extendedProperties: payload.guestId
        ? { private: { ssFamilyGuestId: payload.guestId } }
        : undefined,
    }

    // Editing a guest updates the same event rather than making a second one.
    let url = base
    let method = 'POST'

    if (payload.existingEventId) {
      const probe = await fetch(`${base}/${encodeURIComponent(payload.existingEventId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (probe.ok) {
        url = `${base}/${encodeURIComponent(payload.existingEventId)}`
        method = 'PATCH'
      }
      // If the event was deleted in Google, fall through and create a new one.
    }

    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })

    const body = await response.json()
    if (!response.ok) {
      return json(
        {
          configured: true,
          error: body?.error?.message ?? 'Google Calendar rejected the event',
          message: 'Could not save the calendar event.',
        },
        502,
      )
    }

    return json({
      configured: true,
      eventId: body.id,
      htmlLink: body.htmlLink,
      message:
        method === 'PATCH'
          ? 'Calendar event updated.'
          : `Added to Google Calendar with a ${reminderDays}-day reminder.`,
    })
  } catch (error) {
    return json(
      {
        configured: true,
        error: error instanceof Error ? error.message : String(error),
        message: 'Could not reach Google Calendar.',
      },
      502,
    )
  }
})
