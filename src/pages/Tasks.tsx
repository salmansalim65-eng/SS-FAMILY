import { useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload, useUsers } from '../lib/hooks'
import {
  countdown,
  daysFromToday,
  dueTone,
  fmtDate,
  priorityTone,
  taskTone,
  titleCase,
  todayISO,
} from '../lib/format'
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
  SearchBar,
  Select,
  Spinner,
  Textarea,
} from '../components/ui'
import type { Guest, Priority, Task, TaskStatus } from '../lib/types'

const SELECT = '*, assignee:users!tasks_assigned_to_fkey(id, name), guest:guests(id, name)'

type Scope = 'mine' | 'open' | 'overdue' | 'all'

const EMPTY = {
  title: '',
  description: '',
  task_type: 'household' as Task['task_type'],
  assigned_to: '',
  due_date: todayISO(),
  priority: 'medium' as Priority,
  guest_id: '',
}

export function TasksPage() {
  const { profile, isHead } = useAuth()
  const toast = useToast()
  const { cooks } = useUsers()
  const [tick, reload] = useReload()

  const [tasks, setTasks] = useState<Task[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('open')
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      supabase
        .from('tasks')
        .select(SELECT)
        .order('status')
        .order('due_date', { nullsFirst: false }),
      supabase.from('guests').select('*').order('arrival_date'),
    ]).then(([taskRes, guestRes]) => {
      if (!active) return
      if (taskRes.error) toast.error(errorMessage(taskRes.error))
      setTasks((taskRes.data ?? []) as Task[])
      setGuests((guestRes.data ?? []) as Guest[])
      setLoading(false)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return tasks
      .filter((task) => {
        if (scope === 'mine' && task.assigned_to !== profile?.id) return false
        if (scope === 'open' && task.status === 'completed') return false
        if (scope === 'overdue') {
          const days = daysFromToday(task.due_date)
          if (task.status === 'completed' || days === null || days >= 0) return false
        }
        if (!term) return true
        return [task.title, task.description, task.assignee?.name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term))
      })
      .sort((a, b) => {
        // open before done, then soonest due date, then priority
        if ((a.status === 'completed') !== (b.status === 'completed')) {
          return a.status === 'completed' ? 1 : -1
        }
        const da = a.due_date ?? '9999-12-31'
        const db = b.due_date ?? '9999-12-31'
        if (da !== db) return da < db ? -1 : 1
        const rank = { high: 0, medium: 1, low: 2 }
        return rank[a.priority] - rank[b.priority]
      })
  }, [tasks, scope, search, profile])

  const counts = useMemo(
    () => ({
      mine: tasks.filter((t) => t.assigned_to === profile?.id && t.status !== 'completed').length,
      open: tasks.filter((t) => t.status !== 'completed').length,
      overdue: tasks.filter(
        (t) => t.status !== 'completed' && (daysFromToday(t.due_date) ?? 99) < 0,
      ).length,
      all: tasks.length,
    }),
    [tasks, profile],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setFormOpen(true)
  }

  const openEdit = (task: Task) => {
    setEditing(task)
    setForm({
      title: task.title,
      description: task.description ?? '',
      task_type: task.task_type,
      assigned_to: task.assigned_to ?? '',
      due_date: task.due_date ?? todayISO(),
      priority: task.priority,
      guest_id: task.guest_id ?? '',
    })
    setFormOpen(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      task_type: form.task_type,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
      priority: form.priority,
      guest_id: form.guest_id || null,
    }

    try {
      if (editing) {
        const { error } = await supabase.from('tasks').update(payload).eq('id', editing.id)
        if (error) throw error
        toast.success('Task updated.')
      } else {
        const { error } = await supabase
          .from('tasks')
          .insert({ ...payload, created_by: profile?.id })
        if (error) throw error
        toast.success('Task created and the assignee notified.')
      }
      setFormOpen(false)
      reload()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (task: Task, status: TaskStatus) => {
    const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(
      status === 'completed'
        ? `"${task.title}" marked complete.`
        : `"${task.title}" is now ${titleCase(status).toLowerCase()}.`,
    )
    reload()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const { error } = await supabase.from('tasks').delete().eq('id', deleting.id)
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setDeleting(null)
    toast.success('Task deleted.')
    reload()
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Tasks</h1>
          <p className="text-sm text-slate-500">
            {counts.open} open
            {counts.overdue > 0 && (
              <span className="font-semibold text-red-600"> · {counts.overdue} overdue</span>
            )}
          </p>
        </div>
        {isHead && <Button onClick={openCreate}>+ New task</Button>}
      </header>

      <div className="mb-5 flex flex-col gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search tasks…" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {(
            [
              ['mine', 'My tasks'],
              ['open', 'Open'],
              ['overdue', 'Overdue'],
              ['all', 'All'],
            ] as [Scope, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              className={`flex flex-none items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                scope === key
                  ? 'bg-palm-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-inset ring-sand-200 hover:bg-sand-50'
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 text-xs font-bold ${
                  scope === key ? 'bg-white/20' : 'bg-sand-200 text-slate-600'
                } ${key === 'overdue' && counts.overdue > 0 && scope !== key ? '!bg-red-100 !text-red-700' : ''}`}
              >
                {counts[key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading tasks" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Nothing to do here"
          description={
            scope === 'mine'
              ? 'You have no open tasks. Approved menu items land here automatically.'
              : 'Tasks appear here when the head of family creates them or approves a menu item.'
          }
          action={isHead ? <Button onClick={openCreate}>+ New task</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              canManage={isHead}
              isMine={task.assigned_to === profile?.id}
              onStatus={(status) => void setStatus(task, status)}
              onEdit={() => openEdit(task)}
              onDelete={() => setDeleting(task)}
            />
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit task' : 'New task'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="task-form" loading={saving}>
              {editing ? 'Save changes' : 'Create task'}
            </Button>
          </>
        }
      >
        <form id="task-form" onSubmit={save} className="space-y-4">
          <Field label="Task title" required>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              placeholder="Prepare Guest Room 1"
            />
          </Field>

          <Field label="Description">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Fresh bedding, towels, check the AC…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Assign to" hint="They get a notification straight away.">
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
            <Field label="Due date">
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={form.task_type}
                onChange={(e) =>
                  setForm({ ...form, task_type: e.target.value as Task['task_type'] })
                }
              >
                <option value="household">Household</option>
                <option value="guest">Guest</option>
                <option value="shopping">Shopping</option>
                <option value="menu">Menu</option>
              </Select>
            </Field>
            <Field label="Related visit">
              <Select
                value={form.guest_id}
                onChange={(e) => setForm({ ...form, guest_id: e.target.value })}
              >
                <option value="">None</option>
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete task"
        message={`Delete "${deleting?.title}"?`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function TaskRow({
  task,
  canManage,
  isMine,
  onStatus,
  onEdit,
  onDelete,
}: {
  task: Task
  canManage: boolean
  isMine: boolean
  onStatus: (status: TaskStatus) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const urgency = dueTone(task.due_date, task.status)
  const accent =
    task.status === 'completed'
      ? 'bg-emerald-500'
      : urgency === 'red'
        ? 'bg-red-500'
        : task.status === 'in_progress'
          ? 'bg-sky-500'
          : task.priority === 'high'
            ? 'bg-red-400'
            : task.priority === 'medium'
              ? 'bg-amber-400'
              : 'bg-slate-300'

  const done = task.status === 'completed'
  const canUpdate = canManage || isMine

  return (
    <Card accent={accent} className="p-4 pl-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`font-bold ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}
            >
              {task.title}
            </h3>
            {task.task_type === 'menu' && <Badge tone="purple">from menu</Badge>}
          </div>

          {task.description && (
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{task.description}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <Badge tone={taskTone(task.status)}>{titleCase(task.status)}</Badge>
            <Badge tone={priorityTone(task.priority)}>{titleCase(task.priority)} priority</Badge>
            {task.due_date && (
              <span
                className={`font-semibold ${
                  urgency === 'red'
                    ? 'text-red-600'
                    : urgency === 'yellow'
                      ? 'text-amber-600'
                      : 'text-slate-500'
                }`}
              >
                📅 {fmtDate(task.due_date, 'dd MMM')} · {done ? 'done' : countdown(task.due_date)}
              </span>
            )}
            {task.assignee?.name && (
              <span className="flex items-center gap-1.5 text-slate-500">
                <Avatar name={task.assignee.name} size="sm" />
                {task.assignee.name}
                {isMine && <span className="font-bold text-palm-700">(you)</span>}
              </span>
            )}
            {task.guest?.name && <span className="text-slate-400">🧳 {task.guest.name}</span>}
          </div>
        </div>

        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col sm:items-stretch">
          {canUpdate && !done && task.status === 'pending' && (
            <Button size="sm" variant="secondary" onClick={() => onStatus('in_progress')}>
              ▶ Start
            </Button>
          )}
          {canUpdate && !done && (
            <Button size="sm" variant="success" onClick={() => onStatus('completed')}>
              ✓ Complete
            </Button>
          )}
          {canUpdate && done && (
            <Button size="sm" variant="ghost" onClick={() => onStatus('pending')}>
              ↩ Reopen
            </Button>
          )}
          {canManage && (
            <div className="flex gap-2">
              <button
                onClick={onEdit}
                className="flex-1 rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
              >
                ✏ Edit
              </button>
              <button
                onClick={onDelete}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
