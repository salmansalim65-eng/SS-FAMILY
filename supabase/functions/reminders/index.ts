// ---------------------------------------------------------------------------
// reminders
//
// Run this once a day (pg_cron, GitHub Actions, any scheduler). It raises:
//   * "task due tomorrow"  for every open task due in 1 day
//   * "guest arriving"     for every visit starting in 3 days
//
// Both are idempotent: a reminder that already went out today is not repeated,
// so running the job more than once a day is harmless.
//
// Optional secret CRON_SECRET: when set, callers must send a matching
// x-cron-secret header.
// ---------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from './cors.ts'

const DAY = 24 * 60 * 60 * 1000

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)
}

function ddMon(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const secret = Deno.env.get('CRON_SECRET')
  if (secret && req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const startOfToday = new Date()
  startOfToday.setUTCHours(0, 0, 0, 0)
  const since = startOfToday.toISOString()

  /** Skip anyone who already got this reminder for this entity today. */
  const alreadySent = async (type: string, entityId: string): Promise<boolean> => {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', type)
      .eq('entity_id', entityId)
      .gte('created_at', since)
    return (count ?? 0) > 0
  }

  let taskReminders = 0
  let guestReminders = 0

  // ------------------------------------------------------ tasks due tomorrow
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, due_date, priority, assigned_to')
    .eq('due_date', isoDate(1))
    .neq('status', 'completed')
    .not('assigned_to', 'is', null)

  for (const task of tasks ?? []) {
    if (await alreadySent('task_due', task.id)) continue

    const { error } = await supabase.rpc('fn_notify', {
      p_users: [task.assigned_to],
      p_type: 'task_due',
      p_title: `Due tomorrow: ${task.title}`,
      p_message: `"${task.title}" is due on ${ddMon(task.due_date)}. Priority: ${task.priority}.`,
      p_entity_type: 'task',
      p_entity_id: task.id,
      p_link: '/tasks',
    })
    if (!error) taskReminders += 1
  }

  // ---------------------------------------------------- guests in 3 days
  const { data: guests } = await supabase
    .from('guests')
    .select('id, name, arrival_date, male_count, female_count, room')
    .eq('arrival_date', isoDate(3))

  const { data: family } = await supabase
    .from('users')
    .select('id')
    .in('role', ['head', 'member'])
    .eq('is_active', true)

  const familyIds = (family ?? []).map((u) => u.id)

  for (const guest of guests ?? []) {
    if (familyIds.length === 0) break
    if (await alreadySent('guest_arriving', guest.id)) continue

    const total = (guest.male_count ?? 0) + (guest.female_count ?? 0)
    const { error } = await supabase.rpc('fn_notify', {
      p_users: familyIds,
      p_type: 'guest_arriving',
      p_title: `${guest.name} arrives in 3 days`,
      p_message:
        `${guest.name} arrives on ${ddMon(guest.arrival_date)} with ${total} guest(s)` +
        `${guest.room ? `, staying in ${guest.room}` : ''}. Time to get everything ready.`,
      p_entity_type: 'guest',
      p_entity_id: guest.id,
      p_link: '/guests',
    })
    if (!error) guestReminders += 1
  }

  // Hand anything newly queued straight to WhatsApp, if that is configured.
  let whatsapp: unknown = 'skipped'
  if (taskReminders + guestReminders > 0) {
    try {
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-whatsapp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      whatsapp = await response.json()
    } catch (error) {
      whatsapp = { error: error instanceof Error ? error.message : String(error) }
    }
  }

  return json({ taskReminders, guestReminders, whatsapp })
})
