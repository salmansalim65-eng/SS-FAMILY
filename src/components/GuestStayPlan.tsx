import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { fmtDate, priorityTone, titleCase } from '../lib/format'
import { shareToWhatsApp } from '../lib/whatsapp'
import { Badge, Button, Card, EmptyState, Select, Spinner } from './ui'
import type { AppUser, Guest, Task } from '../lib/types'

/** Group the plan the way the stay actually unfolds: by the day it is due. */
interface Day {
  date: string
  label: string
  tasks: Task[]
}

function dayLabel(date: string, guest: Guest): string {
  if (date === guest.arrival_date) return 'Arrival day'
  if (guest.departure_date && date === guest.departure_date) return 'Departure day'
  if (date < guest.arrival_date) return 'Getting ready'
  if (guest.departure_date && date > guest.departure_date) return 'After they go'
  const night = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() -
      new Date(`${guest.arrival_date}T00:00:00Z`).getTime()) /
      86_400_000,
  )
  return `Day ${night + 1}`
}

/**
 * One guest's hospitality plan, as it stands right now.
 *
 * The same rows as the Tasks page, but read the way the stay is lived — day by
 * day — so it is obvious at a glance whether tomorrow is covered.
 */
export function GuestStayPlan({ guest, onChanged }: { guest: Guest; onChanged?: () => void }) {
  const { profile, isHead } = useAuth()
  const toast = useToast()

  const [tasks, setTasks] = useState<Task[]>([])
  const [family, setFamily] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [hideDone, setHideDone] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const [taskRes, userRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, assignee:users!tasks_assigned_to_fkey(id, name)')
        .eq('guest_id', guest.id)
        .not('stay_plan_key', 'is', null)
        .order('due_date')
        .order('priority'),
      // Includes the driver: the Haram run and the airport drop are theirs.
      supabase.from('users').select('*').eq('is_active', true).order('name'),
    ])

    if (taskRes.error) toast.error(errorMessage(taskRes.error))
    setTasks((taskRes.data ?? []) as unknown as Task[])
    setFamily((userRes.data ?? []) as unknown as AppUser[])
    setLoading(false)
  }, [guest.id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo<Day[]>(() => {
    const byDate = new Map<string, Task[]>()
    for (const t of tasks) {
      if (hideDone && t.status === 'completed') continue
      const key = t.due_date ?? 'someday'
      byDate.set(key, [...(byDate.get(key) ?? []), t])
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, label: dayLabel(date, guest), tasks: list }))
  }, [tasks, hideDone, guest])

  const done = tasks.filter((t) => t.status === 'completed').length
  const unassigned = tasks.filter((t) => !t.assigned_to && t.status !== 'completed').length
  const percent = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100)

  // ------------------------------------------------------------------ actions
  const toggle = async (task: Task) => {
    if (busy[task.id]) return
    setBusy((b) => ({ ...b, [task.id]: true }))

    const next = task.status === 'completed' ? 'pending' : 'completed'
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status: next } : t)))

    const { error } = await supabase.from('tasks').update({ status: next }).eq('id', task.id)
    setBusy((b) => ({ ...b, [task.id]: false }))

    if (error) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)))
      toast.error(errorMessage(error))
      return
    }
    onChanged?.()
  }

  const assign = async (task: Task, userId: string) => {
    const who = family.find((u) => u.id === userId)
    setTasks((ts) =>
      ts.map((t) =>
        t.id === task.id
          ? { ...t, assigned_to: userId || null, assignee: who ? { id: who.id, name: who.name } : null }
          : t,
      ),
    )
    const { error } = await supabase
      .from('tasks')
      .update({ assigned_to: userId || null })
      .eq('id', task.id)
    if (error) {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)))
      toast.error(errorMessage(error))
    }
  }

  const share = () => {
    const lines = [`*Stay plan — ${guest.name}*`, '']
    for (const day of days) {
      lines.push(`*${day.label} · ${fmtDate(day.date, 'EEE dd MMM')}*`)
      for (const t of day.tasks) {
        const mark = t.status === 'completed' ? '✅' : '⬜'
        lines.push(`${mark} ${t.title.replace(` — ${guest.name}`, '')}` +
          (t.assignee ? ` (${t.assignee.name})` : ''))
      }
      lines.push('')
    }
    lines.push('_SS Family_')
    shareToWhatsApp(lines.join('\n'))
  }

  if (loading) return <Spinner label="Loading the plan" />

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon="🧳"
        title="No stay plan for this visit"
        description={
          guest.guest_type === 'dinner'
            ? 'Dinner guests get a menu instead — a stay plan is for guests who sleep here.'
            : 'Edit the arrival or departure date to lay the plan out, or check the plan in Guests → Stay plan.'
        }
      />
    )
  }

  return (
    <div>
      {/* ------------------------------------------------------------ progress */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl" aria-hidden>
            {percent === 100 ? '🎉' : '🧳'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-800">
              {done} of {tasks.length} done
            </p>
            <p className="text-xs text-slate-500">
              {unassigned > 0
                ? `${unassigned} still need someone — pick a name below.`
                : 'Everything has someone looking after it.'}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setHideDone((v) => !v)}>
            {hideDone ? 'Show done' : 'Hide done'}
          </Button>
          <Button
            variant="secondary"
            onClick={share}
            title="Send this checklist on WhatsApp"
          >
            💬 Share
          </Button>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand-100">
          <div
            className="h-full rounded-full bg-palm-500 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </Card>

      {/* ---------------------------------------------------------- day by day */}
      <div className="space-y-4">
        {days.map((day) => {
          const left = day.tasks.filter((t) => t.status !== 'completed').length
          return (
            <Card key={day.date} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-sand-100 bg-sand-50/60 px-4 py-3">
                <span className="font-bold text-slate-800">{day.label}</span>
                <span className="text-xs text-slate-500">{fmtDate(day.date, 'EEE dd MMM')}</span>
                <span className="flex-1" />
                <Badge tone={left === 0 ? 'green' : 'yellow'}>
                  {left === 0 ? 'All done' : `${left} to do`}
                </Badge>
              </div>

              <ul className="divide-y divide-sand-100">
                {day.tasks.map((task) => {
                  const complete = task.status === 'completed'
                  const mine = task.assigned_to === profile?.id
                  const canTick = isHead || mine || !task.assigned_to

                  return (
                    <li key={task.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <button
                        onClick={() => void toggle(task)}
                        disabled={!canTick || busy[task.id]}
                        className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg text-sm font-bold transition disabled:opacity-40 ${
                          complete
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-sand-100 text-transparent hover:bg-emerald-100 hover:text-emerald-600'
                        }`}
                        aria-label={complete ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        aria-pressed={complete}
                      >
                        ✓
                      </button>

                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-semibold ${
                            complete ? 'text-slate-400 line-through' : 'text-slate-800'
                          }`}
                        >
                          {task.title.replace(` — ${guest.name}`, '')}
                        </p>
                        {task.description && !complete && (
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                            {task.description}
                          </p>
                        )}
                        {task.priority === 'high' && !complete && (
                          <Badge tone={priorityTone(task.priority)} className="mt-1">
                            {titleCase(task.priority)}
                          </Badge>
                        )}
                      </div>

                      {isHead ? (
                        <Select
                          value={task.assigned_to ?? ''}
                          onChange={(e) => void assign(task, e.target.value)}
                          className="w-36 flex-none"
                          aria-label={`Who does ${task.title}`}
                        >
                          <option value="">Nobody yet</option>
                          {family.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={task.assignee ? 'blue' : 'yellow'}>
                          {task.assignee ? task.assignee.name : 'nobody yet'}
                        </Badge>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
