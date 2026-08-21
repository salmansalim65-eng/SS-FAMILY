// ---------------------------------------------------------------------------
// google-calendar
//
// Creates (or updates) an all-day Google Calendar event for a guest visit,
// with a reminder 3 days before arrival.
//
// Secrets required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_ID   (optional, defaults to "primary")
//
// With none of them set the function is a well-behaved no-op: it replies
// { configured: false } and the app falls back to an "Add to Calendar" link
// and an .ics download, so nothing in the product breaks.
// ---------------------------------------------------------------------------
import { corsHeaders, json } from './cors.ts'

interface Payload {
  guestId?: string
  summary: string
  description?: string
  location?: string
  startDate: string
  endDate?: string | null
  reminderDaysBefore?: number
  existingEventId?: string | null
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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

  if (!payload.summary || !payload.startDate) {
    return json({ configured: true, error: 'summary and startDate are required' }, 400)
  }

  const reminderDays = payload.reminderDaysBefore ?? 3
  const reminderMinutes = reminderDays * 24 * 60

  // Google treats an all-day event's end date as exclusive.
  const start = payload.startDate
  const end = addDays(payload.endDate || payload.startDate, 1)

  const event = {
    summary: payload.summary,
    description: payload.description ?? '',
    location: payload.location ?? '',
    start: { date: start },
    end: { date: end },
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

  try {
    const token = await accessToken(clientId, clientSecret, refreshToken)

    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    const url = payload.existingEventId
      ? `${base}/${encodeURIComponent(payload.existingEventId)}`
      : base

    const response = await fetch(url, {
      method: payload.existingEventId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    })

    const body = await response.json()
    if (!response.ok) {
      return json(
        {
          configured: true,
          error: body?.error?.message ?? 'Google Calendar rejected the event',
          message: 'Could not create the calendar event.',
        },
        502,
      )
    }

    return json({
      configured: true,
      eventId: body.id,
      htmlLink: body.htmlLink,
      message: `Event created with a ${reminderDays}-day reminder.`,
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
