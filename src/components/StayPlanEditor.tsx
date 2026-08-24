import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useUsers } from '../lib/hooks'
import { priorityTone, titleCase } from '../lib/format'
import { STAY_PHASES } from '../lib/types'
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea } from './ui'
import type { Priority, StayPhase, StayPlanTemplate } from '../lib/types'

const EMPTY = {
  key: '',
  title: '',
  description: '',
  phase: 'before' as StayPhase,
  offset_days: '1',
  every_days: '2',
  min_nights: '0',
  priority: 'medium' as Priority,
  default_assignee: '',
}

/** How a template's timing reads in plain words. */
function timing(t: StayPlanTemplate): string {
  switch (t.phase) {
    case 'before':
      return t.offset_days === 0 ? 'on arrival day' : `${t.offset_days} day(s) before they arrive`
    case 'arrival':
      return 'the day they arrive'
    case 'daily':
      return 'every day of the stay'
    case 'periodic':
      return `every ${t.every_days} day(s)`
    case 'departure':
      return 'the day they leave'
    case 'after':
      return t.offset_days === 0 ? 'departure day' : `${t.offset_days} day(s) after they leave`
  }
}

/**
 * The house's hospitality standard, written down once.
 *
 * Adding a staying guest turns this list into real dated tasks for that
 * visit — so this page is about what the household always does, not about
 * any one guest.
 */
export function StayPlanEditor() {
  const { isHead } = useAuth()
  const toast = useToast()
  const { cooks } = useUsers()

  const [rows, setRows] = useState<StayPlanTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<StayPlanTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('stay_plan_templates')
      .select('*, assignee:users!stay_plan_templates_default_assignee_fkey(id, name)')
      .order('sort_order')

    if (error) toast.error(errorMessage(error))
    setRows((data ?? []) as unknown as StayPlanTemplate[])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const byPhase = useMemo(
    () => STAY_PHASES.map((phase) => [phase, rows.filter((r) => r.phase === phase.key)] as const),
    [rows],
  )

  const activeCount = rows.filter((r) => r.is_active).length

  /** Roughly what a week-long visit turns into, so the size is no surprise. */
  const weekEstimate = useMemo(() => {
    const nights = 7
    return rows
      .filter((r) => r.is_active && r.min_nights <= nights)
      .reduce((sum, r) => {
        if (r.phase === 'daily') return sum + nights + 1
        if (r.phase === 'periodic') return sum + Math.floor(nights / Math.max(r.every_days, 1))
        return sum + 1
      }, 0)
  }, [rows])

  // ------------------------------------------------------------------ actions
  const patch = async (row: StayPlanTemplate, changes: Partial<StayPlanTemplate>) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...changes } : r)))
    const { assignee: _drop, ...writable } = changes as Record<string, unknown>
    const { error } = await supabase
      .from('stay_plan_templates')
      .update(writable)
      .eq('id', row.id)
    if (error) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? row : r)))
      toast.error(errorMessage(error))
    }
  }

  const openEdit = (row: StayPlanTemplate) => {
    setForm({
      key: row.key,
      title: row.title,
      description: row.description ?? '',
      phase: row.phase,
      offset_days: String(row.offset_days),
      every_days: String(row.every_days),
      min_nights: String(row.min_nights),
      priority: row.priority,
      default_assignee: row.default_assignee ?? '',
    })
    setEditing(row)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      phase: form.phase,
      offset_days: Number(form.offset_days) || 0,
      every_days: Math.max(Number(form.every_days) || 1, 1),
      min_nights: Number(form.min_nights) || 0,
      priority: form.priority,
      default_assignee: form.default_assignee || null,
    }

    const { error } = creating
      ? await supabase.from('stay_plan_templates').insert({
          ...payload,
          key: form.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          sort_order: (rows.length > 0 ? rows[rows.length - 1].sort_order : 100) + 10,
        })
      : await supabase.from('stay_plan_templates').update(payload).eq('id', editing?.id ?? '')

    setSaving(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(creating ? 'Added to the plan.' : 'Plan updated.')
    setEditing(null)
    setCreating(false)
    await load()
  }

  if (loading) return <Spinner label="Loading the stay plan" />

  return (
    <div>
      <Card className="mb-5 flex flex-wrap items-center gap-3 border-palm-200 bg-palm-50 p-4">
        <span className="text-2xl" aria-hidden>
          🏠
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-palm-900">How we look after a guest who stays</p>
          <p className="mt-0.5 text-sm text-palm-800">
            {activeCount} thing{activeCount === 1 ? '' : 's'} we always do. Adding a staying guest
            turns this into dated tasks for that visit — about{' '}
            <strong>{weekEstimate}</strong> of them for a week-long stay. A dinner guest gets none
            of it.
          </p>
        </div>
        {isHead && (
          <Button
            onClick={() => {
              setForm({ ...EMPTY })
              setCreating(true)
              setEditing(null)
            }}
          >
            + Add
          </Button>
        )}
      </Card>

      <div className="space-y-5">
        {byPhase.map(([phase, group]) => (
          <section key={phase.key}>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500">
              <span aria-hidden>{phase.icon}</span>
              {phase.label}
            </h2>
            <p className="mb-2 text-xs text-slate-400">{phase.blurb}</p>

            {group.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <Card className="divide-y divide-sand-100">
                {group.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <label className="mt-0.5 flex-none">
                      <input
                        type="checkbox"
                        checked={row.is_active}
                        disabled={!isHead}
                        onChange={(e) => void patch(row, { is_active: e.target.checked })}
                        className="h-4 w-4 accent-palm-600"
                        aria-label={`${row.is_active ? 'Turn off' : 'Turn on'} ${row.title}`}
                      />
                    </label>

                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-semibold ${
                          row.is_active ? 'text-slate-800' : 'text-slate-400 line-through'
                        }`}
                      >
                        {row.title}
                      </p>
                      {row.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                          {row.description}
                        </p>
                      )}
                      <p className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="gray">{timing(row)}</Badge>
                        {row.min_nights > 0 && (
                          <Badge tone="gray">only if {row.min_nights}+ nights</Badge>
                        )}
                        <Badge tone={priorityTone(row.priority)}>{titleCase(row.priority)}</Badge>
                        <Badge tone={row.assignee ? 'blue' : 'yellow'}>
                          {row.assignee ? `👤 ${row.assignee.name}` : 'nobody assigned yet'}
                        </Badge>
                      </p>
                    </div>

                    {isHead && (
                      <div className="flex flex-none items-center gap-2">
                        <Select
                          value={row.default_assignee ?? ''}
                          onChange={(e) =>
                            void patch(row, {
                              default_assignee: e.target.value || null,
                              assignee: cooks.find((u) => u.id === e.target.value) ?? null,
                            })
                          }
                          className="w-36"
                          aria-label={`Who does ${row.title}`}
                        >
                          <option value="">Decide later</option>
                          {cooks.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                        <button
                          onClick={() => {
                            setCreating(false)
                            openEdit(row)
                          }}
                          className="rounded-lg bg-sand-100 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                        >
                          ✏ Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </section>
        ))}
      </div>

      <p className="mt-5 text-xs leading-relaxed text-slate-500">
        Changes apply to the next guest you add, and to any upcoming visit whose dates you edit.
        Work already marked done is never removed.
      </p>

      {/* -------------------------------------------------------------- form */}
      <Modal
        open={editing !== null || creating}
        onClose={() => {
          setEditing(null)
          setCreating(false)
        }}
        title={creating ? 'Add to the stay plan' : `Edit "${editing?.title ?? ''}"`}
        wide
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(null)
                setCreating(false)
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" form="stay-plan-form" loading={saving}>
              {creating ? 'Add' : 'Save'}
            </Button>
          </>
        }
      >
        <form id="stay-plan-form" onSubmit={save} className="space-y-4">
          <Field label="What needs doing" required>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
              placeholder="Fresh flowers in the guest room"
            />
          </Field>

          <Field label="Details" hint="Whatever the person doing it would want to know.">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>

          <Field label="When" required>
            <Select
              value={form.phase}
              onChange={(e) => setForm({ ...form, phase: e.target.value as StayPhase })}
            >
              {STAY_PHASES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.icon} {p.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(form.phase === 'before' || form.phase === 'after') && (
              <Field
                label={form.phase === 'before' ? 'Days before arrival' : 'Days after departure'}
              >
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={form.offset_days}
                  onChange={(e) => setForm({ ...form, offset_days: e.target.value })}
                />
              </Field>
            )}

            {form.phase === 'periodic' && (
              <Field label="Repeat every (days)">
                <Input
                  type="number"
                  min={1}
                  max={14}
                  value={form.every_days}
                  onChange={(e) => setForm({ ...form, every_days: e.target.value })}
                />
              </Field>
            )}

            <Field label="Only if staying at least (nights)" hint="0 means always.">
              <Input
                type="number"
                min={0}
                max={30}
                value={form.min_nights}
                onChange={(e) => setForm({ ...form, min_nights: e.target.value })}
              />
            </Field>

            <Field label="Priority">
              <Select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </Field>
          </div>

          <Field label="Who usually does it?" hint="They get the task the moment a guest is added.">
            <Select
              value={form.default_assignee}
              onChange={(e) => setForm({ ...form, default_assignee: e.target.value })}
            >
              <option value="">Decide later</option>
              {cooks.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>

          {creating && (
            <Field label="Short id" required hint="Lowercase, no spaces. Used to recognise it later.">
              <Input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                required
                placeholder="fresh_flowers"
              />
            </Field>
          )}
        </form>
      </Modal>
    </div>
  )
}
