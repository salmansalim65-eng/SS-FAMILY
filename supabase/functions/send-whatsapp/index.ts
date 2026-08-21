// ---------------------------------------------------------------------------
// send-whatsapp
//
// Drains the notification queue: every notification row whose whatsapp_status
// is 'queued' is sent to its recipient's WhatsApp number through Twilio, then
// marked 'sent' or 'failed'.
//
// Secrets required:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//
// With none of them set, queued rows are marked 'disabled' so the inbox shows
// honestly that WhatsApp is not wired up rather than leaving them pending
// forever. Run it on a schedule, or call it right after a notification fires.
// ---------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from './cors.ts'

interface QueuedRow {
  id: string
  title: string
  message: string
  user_id: string
  users: { name: string; whatsapp_number: string | null } | null
}

function normalise(number: string): string {
  const trimmed = number.trim()
  if (trimmed.startsWith('whatsapp:')) return trimmed
  return `whatsapp:${trimmed.replace(/[^\d+]/g, '')}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, message, user_id, users!inner(name, whatsapp_number)')
    .eq('whatsapp_status', 'queued')
    .limit(50)

  if (error) return json({ error: error.message }, 500)

  const queued = (data ?? []) as unknown as QueuedRow[]
  if (queued.length === 0) return json({ sent: 0, failed: 0, message: 'Nothing queued.' })

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM')

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

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: normalise(from),
          To: normalise(to),
          Body: `*${row.title}*\n\n${row.message}\n\n_SS Family planner_`,
        }),
      })

      const body = await response.json()

      if (response.ok) {
        sent += 1
        await supabase
          .from('notifications')
          .update({ whatsapp_status: 'sent', whatsapp_error: null })
          .eq('id', row.id)
      } else {
        failed += 1
        await supabase
          .from('notifications')
          .update({
            whatsapp_status: 'failed',
            whatsapp_error: String(body?.message ?? 'Twilio rejected the message'),
          })
          .eq('id', row.id)
      }
    } catch (err) {
      failed += 1
      await supabase
        .from('notifications')
        .update({
          whatsapp_status: 'failed',
          whatsapp_error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', row.id)
    }
  }

  return json({ configured: true, sent, failed, processed: queued.length })
})
