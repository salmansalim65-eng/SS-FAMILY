// ---------------------------------------------------------------------------
// send-whatsapp
//
// Drains the notification queue through Twilio: every notification whose
// whatsapp_status is 'queued' (or 'failed' with attempts left) is sent to its
// recipient's WhatsApp number, then marked 'sent' or 'failed'. pg_cron calls
// this every 5 minutes; it is a no-op when the queue is empty.
//
// Secrets required:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//
// Optional:
//   TWILIO_CONTENT_SID — a Twilio Content template. WhatsApp only allows
//   free-form text within 24 hours of the recipient's last message; outside
//   that window an approved template is the only thing that gets through. Set
//   this and every message goes out as that template with {{1}} = title and
//   {{2}} = body, which is what makes the 3pm reminders actually arrive.
//
// With no credentials set, queued rows are marked 'disabled' so the inbox says
// honestly that WhatsApp is not wired up rather than leaving them pending.
// ---------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from './cors.ts'

/** A reminder nobody sent yesterday is not worth sending today. */
const MAX_AGE_HOURS = 24
/** Twilio rejects a bad number the same way every time; three tries is plenty. */
const MAX_ATTEMPTS = 3
const BATCH = 50

interface QueuedRow {
  id: string
  title: string
  message: string
  user_id: string
  created_at: string
  whatsapp_attempts: number
  users: { name: string; whatsapp_number: string | null } | null
}

function normalise(number: string): string {
  const trimmed = number.trim()
  if (trimmed.startsWith('whatsapp:')) return trimmed
  return `whatsapp:${trimmed.replace(/[^\d+]/g, '')}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const supabase = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  let body: { test?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    // cron posts an empty body; that is fine
  }

  // -------------------------------------------------------------------- test
  // "Send me a test message" from Settings. This one path can cost real money
  // on demand, so unlike the drain it needs a signed-in head of family.
  if (body.test) {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Not signed in.' }, 401)

    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user: caller },
    } = await asCaller.auth.getUser()
    if (!caller) return json({ error: 'Not signed in.' }, 401)

    const { data: profile } = await supabase
      .from('users')
      .select('role, whatsapp_number')
      .eq('id', caller.id)
      .maybeSingle()

    if (profile?.role !== 'head') {
      return json({ error: 'Only the head of family can send a test message.' }, 403)
    }
    if (!profile?.whatsapp_number) {
      return json({ error: 'Add your own WhatsApp number first, then try again.' }, 400)
    }

    await supabase.from('notifications').insert({
      user_id: caller.id,
      type: 'system',
      title: 'WhatsApp test',
      message: 'If you are reading this on WhatsApp, delivery is working.',
      sent_via: ['in_app', 'whatsapp'],
      whatsapp_status: 'queued',
    })
    // fall through and drain immediately
  }

  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000).toISOString()

  // Retire anything too old to be worth delivering before picking up the rest.
  await supabase
    .from('notifications')
    .update({ whatsapp_status: 'disabled', whatsapp_error: 'Too old to send.' })
    .in('whatsapp_status', ['queued', 'failed'])
    .lt('created_at', cutoff)

  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, message, user_id, created_at, whatsapp_attempts, users!inner(name, whatsapp_number)')
    .in('whatsapp_status', ['queued', 'failed'])
    .lt('whatsapp_attempts', MAX_ATTEMPTS)
    .gte('created_at', cutoff)
    .order('created_at')
    .limit(BATCH)

  if (error) return json({ error: error.message }, 500)

  const queued = (data ?? []) as unknown as QueuedRow[]
  if (queued.length === 0) return json({ sent: 0, failed: 0, message: 'Nothing queued.' })

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM')
  const contentSid = Deno.env.get('TWILIO_CONTENT_SID')

  if (!sid || !token || !from) {
    await supabase
      .from('notifications')
      .update({
        whatsapp_status: 'disabled',
        whatsapp_error: 'Twilio credentials are not configured.',
      })
      .in('id', queued.map((row) => row.id))

    return json({
      configured: false,
      sent: 0,
      failed: 0,
      skipped: queued.length,
      message:
        'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and ' +
        'TWILIO_WHATSAPP_FROM to deliver WhatsApp messages.',
    })
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const auth = btoa(`${sid}:${token}`)

  let sent = 0
  let failed = 0

  for (const row of queued) {
    const to = row.users?.whatsapp_number
    if (!to) {
      await supabase
        .from('notifications')
        .update({ whatsapp_status: 'disabled', whatsapp_error: 'No WhatsApp number on file.' })
        .eq('id', row.id)
      continue
    }

    const params = new URLSearchParams({ From: normalise(from), To: normalise(to) })
    if (contentSid) {
      params.set('ContentSid', contentSid)
      params.set('ContentVariables', JSON.stringify({ 1: row.title, 2: row.message }))
    } else {
      params.set('Body', `*${row.title}*\n\n${row.message}\n\n_SS Family planner_`)
    }

    const attempts = (row.whatsapp_attempts ?? 0) + 1

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      })

      const result = await response.json()

      if (response.ok) {
        sent += 1
        await supabase
          .from('notifications')
          .update({ whatsapp_status: 'sent', whatsapp_error: null, whatsapp_attempts: attempts })
          .eq('id', row.id)
      } else {
        failed += 1
        // Twilio's own wording is the useful part — 63016 means "outside the
        // 24-hour window, use a template", which is the one people hit first.
        const detail = String(result?.message ?? 'Twilio rejected the message')
        const code = result?.code ? ` (code ${result.code})` : ''
        await supabase
          .from('notifications')
          .update({
            whatsapp_status: attempts >= MAX_ATTEMPTS ? 'disabled' : 'failed',
            whatsapp_error: `${detail}${code}`,
            whatsapp_attempts: attempts,
          })
          .eq('id', row.id)
      }
    } catch (err) {
      failed += 1
      await supabase
        .from('notifications')
        .update({
          whatsapp_status: attempts >= MAX_ATTEMPTS ? 'disabled' : 'failed',
          whatsapp_error: err instanceof Error ? err.message : String(err),
          whatsapp_attempts: attempts,
        })
        .eq('id', row.id)
    }
  }

  return json({
    configured: true,
    templated: Boolean(contentSid),
    sent,
    failed,
    processed: queued.length,
  })
})
