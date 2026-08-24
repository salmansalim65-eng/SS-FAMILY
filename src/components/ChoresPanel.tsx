import { useEffect, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload, useUsers } from '../lib/hooks'
import { countdown, fmtDate, priorityTone, titleCase, todayISO } from '../lib/format'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from './ui'
import { WEEKDAYS } from '../lib/types'
import type { Frequency, Priority, RecurringTask } from '../lib/types'

const SELECT = '*, assignee:users!recurring_tasks_assigned_to_fkey(id, name)'

const EMPTY = {
  title: '',
  description: '',
  assigned_to: '',
  priority: 'medium' as Priority,
  frequency: 'weekly' as Frequency,
  day_of_week: '1',
  day_of_month: '1',
  next_due: todayISO(),
}

function describe(chore: RecurringTask): string {
  if (chore.frequency === 'daily') return 'Every day'
  if (chore.frequency === 'weekly') {
    return chore.day_of_week === null
      ? 'Every week'
      : `Every ${WEEKDAYS[chore.day_of_week]}`
  }
  const d = chore.day_of_month ?? 1
  const suffix = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'
  return `Monthly on the ${d}${suffix}`
}

/**
 * Recurring chores. Each row is a template; a nightly job turns it into a real
 * task when it falls due, so chores get the same assignment, notification and
 * completion handling as anything else.
 */
export function ChoresPanel() {
  const { profile, isHead } = useAuth()
  const toast = useToast()
  const { cooks } = useUsers()
  const [tick, reload] = useReload()

  const [chores, setChores] = useState<RecurringTask[]>([])
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringTask | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<RecurringTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('recurring_tasks')
      .select(SELECT)
      .order('is_active', { ascending: false })
      .order('next_due')
      .then(({ data, error }) => {
        if (!active) return
        if (error) toast.error(errorMessage(error))
        setChores((data ?? []) as unknown as RecurringTask[])
        setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setFormOpen(true)
  }

  const openEdit = (chore: RecurringTask) => {
    setEditing(chore)
    setForm({
      title: chore.title,
      description: chore.description ?? '',
      assigned_to: chore.assigned_to ?? '',
      priority: chore.priority,
      frequency: chore.frequency,
      day_of_week: String(chore.day_of_week ?? 1),
      day_of_month: String(chore.day_of_month ?? 1),
      next_due: chore.next_due,
    })
    setFormOpen(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      assigned_to: form.assigned_to || null,
      priority: form.priority,
      frequency: form.frequency,
      day_of_week: form.frequency === 'weekly' ? Number(form.day_of_week) : null,
      day_of_month: form.frequency === 'monthly' ? Number(form.day_of_month) : null,
      next_due: form.next_due,
    }

    try {
      if (editing) {
        const { error } = await supabase
          .from('recurring_tasks')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
        toast.success('Chore updated.')
      } else {
        const { error } = await supabase
          .from('recurring_tasks')
          .insert({ ...payload, created_by: profile?.id })
        if (error) throw error
        toast.success('Chore added. It will appear as a task when it falls due.')
      }
      setFormOpen(false)
      reload()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (chore: RecurringTask) => {
    const { error } = await supabase
      .from('recurring_tasks')
      .update({ is_active: !chore.is_active })
      .eq('id', chore.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(chore.is_active ? 'Chore paused.' : 'Chore resumed.')
    reload()
  }

  const runNow = async () => {
    setRunning(true)
    const { data, error } = await supabase.rpc('generate_recurring_tasks')
    setRunning(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    const made = Number(data ?? 0)
    toast.success(
      made === 0 ? 'Nothing is due yet.' : `${made} task${made === 1 ? '' : 's'} created.`,
    )
    reload()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const { error } = await supabase.from('recurring_tasks').delete().eq('id', deleting.id)
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setDeleting(null)
    toast.success('Chore removed. Tasks already created stay.')
    reload()
  }

  if (loading) return <Spinner label="Loading chores" />

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Chores turn into tasks automatically each morning as they fall due.
        </p>
        {isHead && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void runNow()} loading={running}>
              ▶ Run now
            </Button>
            <Button onClick={openCreate}>+ Add chore</Button>
          </div>
        )}
      </div>

      {chores.length === 0 ? (
        <EmptyState
          icon="🔁"
          title="No recurring chores yet"
          description={
            isHead
              ? 'Add things that come round regularly — changing bedsheets, watering plants, servicing the AC.'
              : 'The head of family has not set any up yet.'
          }
          action={isHead ? <Button onClick={openCreate}>+ Add chore</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {chores.map((chore) => (
            <Card
              key={chore.id}
              accent={chore.is_active ? 'bg-violet-500' : 'bg-slate-300'}
              className={`p-4 pl-5 ${chore.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-slate-800">{chore.title}</h3>
                    <Badge tone="purple">🔁 {describe(chore)}</Badge>
                    {!chore.is_active && <Badge tone="gray">Paused</Badge>}
                  </div>

                  {chore.description && (
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {chore.description}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <Badge tone={priorityTone(chore.priority)}>
                      {titleCase(chore.priority)} priority
                    </Badge>
                    <span className="font-semibold text-slate-500">
                      📅 Next: {fmtDate(chore.next_due, 'dd MMM')} ·{' '}
                      {chore.is_active ? countdown(chore.next_due) : 'paused'}
                    </span>
                    {chore.assignee?.name && (
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <Avatar name={chore.assignee.name} size="sm" />
                        {chore.assignee.name}
                      </span>
                    )}
                    {!chore.assignee && <span className="text-slate-400">Unassigned</span>}
                  </div>
                </div>

                {isHead && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void toggleActive(chore)}
                      className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                    >
                      {chore.is_active ? '⏸ Pause' : '▶ Resume'}
                    </button>
                    <button
                      onClick={() => openEdit(chore)}
                      className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                    >
                      ✏ Edit
                    </button>
                    <button
                      onClick={() => setDeleting(chore)}
                      className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------ form */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit chore' : 'Add recurring chore'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="chore-form" loading={saving}>
              {editing ? 'Save changes' : 'Add chore'}
            </Button>
          </>
        }
      >
        <form id="chore-form" onSubmit={save} className="space-y-4">
          <Field label="Chore" required>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
              placeholder="Change bedsheets in guest rooms"
            />
          </Field>

          <Field label="Details">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="All three rooms, wash the old set the same day."
            />
          </Field>

          <Field label="How often" required>
            <div className="grid grid-cols-3 gap-2">
              {(['daily', 'weekly', 'monthly'] as Frequency[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setForm({ ...form, frequency: f })}
                  className={`rounded-xl border-2 py-3 text-sm font-bold capitalize transition ${
                    form.frequency === f
                      ? 'border-palm-500 bg-palm-50 text-palm-800'
                      : 'border-sand-200 bg-white text-slate-600 hover:border-sand-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </Field>

          {form.frequency === 'weekly' && (
            <Field label="Which day">
              <Select
                value={form.day_of_week}
                onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}
              >
                {WEEKDAYS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {form.frequency === 'monthly' && (
            <Field label="Day of month" hint="1 to 28, so no month is ever skipped.">
              <Select
                value={form.day_of_month}
                onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Assign to" hint="They are notified each time it is created.">
              <Select
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
              >
                <option value="">Unassigned</option>
                {cooks.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Start from" required hint="The first date it should be created.">
              <Input
                type="date"
                value={form.next_due}
                onChange={(e) => setForm({ ...form, next_due: e.target.value })}
                required
              />
            </Field>
          </div>

          <Field label="Priority">
            <div className="grid grid-cols-3 gap-2">
              {(['high', 'medium', 'low'] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm({ ...form, priority: p })}
                  className={`rounded-xl border-2 py-3 text-sm font-bold capitalize transition ${
                    form.priority === p
                      ? p === 'high'
                        ? 'border-red-400 bg-red-50 text-red-700'
                        : p === 'medium'
                          ? 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-slate-300 bg-slate-50 text-slate-700'
                      : 'border-sand-200 bg-white text-slate-500 hover:border-sand-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete chore"
        message={`Stop creating "${deleting?.title}"? Tasks already generated from it stay on the task list.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
