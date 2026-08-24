// ---------------------------------------------------------------------------
// send-push
//
// Drains the notification queue to every device the recipient has registered.
// pg_cron calls this once a minute; it returns immediately when nothing is
// waiting, so an idle minute costs nothing.
//
// Secrets required:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//
// web-push is used only to build the encrypted body and the signed VAPID
// headers — a pure function, no sockets. The request itself goes out through
// fetch, which is the one HTTP client the edge runtime is happiest with.
// ---------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { corsHeaders, json } from './cors.ts'

/** A notification nobody delivered yesterday is not worth delivering today. */
const MAX_AGE_HOURS = 24
/** After this many consecutive failures a device is assumed gone. */
const MAX_FAILURES = 5
const BATCH = 100

interface Row {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  link: string | null
}

interface Device {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  failures: number
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
    // cron posts an empty body
  }

  // -------------------------------------------------------------------- test
  // "Send a test notification" from Settings. Anyone signed in may ping their
  // own devices — it cannot reach anybody else's.
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

    const { error: insertError } = await supabase.from('notifications').insert({
      user_id: caller.id,
      type: 'system',
      title: 'Test notification',
      message: 'Push notifications are working on this device.',
      sent_via: ['in_app', 'push'],
      push_status: 'queued',
    })
    if (insertError) return json({ error: insertError.message }, 500)
    // fall through and deliver it now
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:family@ssfamily.local'

  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600_000).toISOString()

  await supabase
    .from('notifications')
    .update({ push_status: 'no_device', push_error: 'Too old to send.' })
    .eq('push_status', 'queued')
    .lt('created_at', cutoff)

  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, type, title, message, link')
    .eq('push_status', 'queued')
    .gte('created_at', cutoff)
    .order('created_at')
    .limit(BATCH)

  if (error) return json({ error: error.message }, 500)

  const queued = (data ?? []) as unknown as Row[]
  if (queued.length === 0) return json({ sent: 0, message: 'Nothing queued.' })

  if (!publicKey || !privateKey) {
    await supabase
      .from('notifications')
      .update({ push_status: 'failed', push_error: 'VAPID keys are not configured.' })
      .in('id', queued.map((r) => r.id))
    return json({
      configured: false,
      sent: 0,
      skipped: queued.length,
      message: 'Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to deliver notifications.',
    })
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)

  // One query for every device belonging to anyone in this batch.
  const userIds = [...new Set(queued.map((r) => r.user_id))]
  const { data: deviceRows } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, failures')
    .in('user_id', userIds)

  const byUser = new Map<string, Device[]>()
  for (const d of (deviceRows ?? []) as unknown as Device[]) {
    const list = byUser.get(d.user_id) ?? []
    list.push(d)
    byUser.set(d.user_id, list)
  }

  let sent = 0
  let failed = 0
  let pruned = 0

  for (const row of queued) {
    const devices = byUser.get(row.user_id) ?? []

    if (devices.length === 0) {
      await supabase
        .from('notifications')
        .update({ push_status: 'no_device', push_error: 'No device registered.' })
        .eq('id', row.id)
      continue
    }

    const payload = JSON.stringify({
      title: row.title,
      body: row.message,
      link: row.link ?? '/',
      type: row.type,
      id: row.id,
    })

    let delivered = 0
    let lastError = ''

    for (const device of devices) {
      try {
        const details = webpush.generateRequestDetails(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          payload,
          { contentEncoding: 'aes128gcm', TTL: 12 * 3600 },
        )

        // Content-Length is a forbidden header for fetch — it sets its own.
        const headers = { ...(details.headers as Record<string, string>) }
        delete headers['Content-Length']

        const response = await fetch(details.endpoint, {
          method: 'POST',
          headers,
          body: details.body,
        })

        if (response.ok) {
          delivered += 1
          if (device.failures > 0) {
            await supabase
              .from('push_subscriptions')
              .update({ failures: 0, last_used_at: new Date().toISOString() })
              .eq('id', device.id)
          } else {
            await supabase
              .from('push_subscriptions')
              .update({ last_used_at: new Date().toISOString() })
              .eq('id', device.id)
          }
          continue
        }

        // 404/410 is the push service saying this subscription is dead — the
        // browser was uninstalled, or permission was revoked. Drop it now
        // rather than retrying it forever.
        if (response.status === 404 || response.status === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', device.id)
          byUser.set(row.user_id, devices.filter((d) => d.id !== device.id))
          pruned += 1
          lastError = `Subscription gone (${response.status}).`
          continue
        }

        const failures = device.failures + 1
        lastError = `Push service returned ${response.status}.`
        if (failures >= MAX_FAILURES) {
          await supabase.from('push_subscriptions').delete().eq('id', device.id)
          pruned += 1
        } else {
          await supabase.from('push_subscriptions').update({ failures }).eq('id', device.id)
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    if (delivered > 0) {
      sent += 1
      await supabase
        .from('notifications')
        .update({ push_status: 'sent', push_error: null })
        .eq('id', row.id)
    } else {
      failed += 1
      await supabase
        .from('notifications')
        .update({ push_status: 'failed', push_error: lastError || 'No device accepted it.' })
        .eq('id', row.id)
    }
  }

  return json({ configured: true, processed: queued.length, sent, failed, pruned })
})
