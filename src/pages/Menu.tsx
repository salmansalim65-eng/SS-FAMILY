import { useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload, useUsers } from '../lib/hooks'
import { fmtDate, menuTone, money, qty, titleCase, todayISO } from '../lib/format'
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
import { MEAL_TYPES, UNITS } from '../lib/types'
import { ShareButton } from '../components/ShareButton'
import { menuMessage } from '../lib/whatsapp'
import type { Guest, MealType, MenuItem, MenuStatus, PrepType } from '../lib/types'

const STATUS_TABS: { key: MenuStatus | 'all'; label: string }[] = [
  { key: 'draft', label: 'Awaiting approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
]

const SELECT =
  '*, suggester:users!menu_items_suggested_by_fkey(id, name),' +
  ' cook:users!menu_items_cook_person_fkey(id, name),' +
  ' outsider:users!menu_items_outside_responsible_fkey(id, name),' +
  ' approver:users!menu_items_approved_by_fkey(id, name),' +
  ' guest:guests(id, name)'

const EMPTY = {
  dish_name: '',
  meal_type: 'dinner' as MealType,
  serve_date: todayISO(),
  guest_id: '',
  cook_person: '',
  homemade_or_outside: 'homemade' as PrepType,
  outside_responsible: '',
  quantity: '1',
  unit: 'serving',
  cost: '0',
  notes: '',
}

export function MenuPage() {
  const { profile, isHead } = useAuth()
  const toast = useToast()
  const { cooks } = useUsers()
  const [tick, reload] = useReload()

  const [items, setItems] = useState<MenuItem[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<MenuStatus | 'all'>('draft')
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<MenuItem | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const [rejecting, setRejecting] = useState<MenuItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [deleting, setDeleting] = useState<MenuItem | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      supabase.from('menu_items').select(SELECT).order('serve_date', { nullsFirst: false }),
      supabase.from('guests').select('*').order('arrival_date'),
    ]).then(([menuRes, guestRes]) => {
      if (!active) return
      if (menuRes.error) toast.error(errorMessage(menuRes.error))
      // The client cannot infer a select string with this many embeds, so the
      // shape is asserted here instead.
      setItems((menuRes.data ?? []) as unknown as MenuItem[])
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
    return items.filter((item) => {
      if (tab !== 'all' && item.status !== tab) return false
      if (!term) return true
      return [item.dish_name, item.notes, item.suggester?.name, item.cook?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    })
  }, [items, tab, search])

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: items.length }
    items.forEach((i) => {
      map[i.status] = (map[i.status] ?? 0) + 1
    })
    return map
  }, [items])

  const totalCost = useMemo(
    () => visible.reduce((sum, item) => sum + Number(item.cost ?? 0), 0),
    [visible],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY, cook_person: profile?.id ?? '' })
    setFormOpen(true)
  }

  const openEdit = (item: MenuItem) => {
    setEditing(item)
    setForm({
      dish_name: item.dish_name,
      meal_type: item.meal_type,
      serve_date: item.serve_date ?? todayISO(),
      guest_id: item.guest_id ?? '',
      cook_person: item.cook_person ?? '',
      homemade_or_outside: item.homemade_or_outside,
      outside_responsible: item.outside_responsible ?? '',
      quantity: String(item.quantity),
      unit: item.unit ?? 'serving',
      cost: String(item.cost),
      notes: item.notes ?? '',
    })
    setFormOpen(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const outside = form.homemade_or_outside === 'outside'
    const payload = {
      dish_name: form.dish_name.trim(),
      meal_type: form.meal_type,
      serve_date: form.serve_date || null,
      guest_id: form.guest_id || null,
      cook_person: outside ? null : form.cook_person || null,
      homemade_or_outside: form.homemade_or_outside,
      outside_responsible: outside ? form.outside_responsible || null : null,
      quantity: Number(form.quantity) || 1,
      unit: form.unit,
      cost: Number(form.cost) || 0,
      notes: form.notes.trim() || null,
    }

    try {
      if (editing) {
        const { error } = await supabase.from('menu_items').update(payload).eq('id', editing.id)
        if (error) throw error
        toast.success('Menu item updated.')
      } else {
        const { error } = await supabase
          .from('menu_items')
          .insert({ ...payload, suggested_by: profile?.id, status: 'draft' })
        if (error) throw error
        toast.success('Suggestion sent to the head of family.')
      }
      setFormOpen(false)
      reload()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const approve = async (item: MenuItem) => {
    const { error } = await supabase
      .from('menu_items')
      .update({ status: 'approved', approved_by: profile?.id, rejection_reason: null })
      .eq('id', item.id)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`"${item.dish_name}" approved — a task was created and assigned.`)
    reload()
  }

  const reject = async () => {
    if (!rejecting) return
    setBusy(true)
    const { error } = await supabase
      .from('menu_items')
      .update({
        status: 'rejected',
        approved_by: profile?.id,
        rejection_reason: rejectReason.trim() || null,
      })
      .eq('id', rejecting.id)
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setRejecting(null)
    setRejectReason('')
    toast.success('Suggestion rejected.')
    reload()
  }

  const backToDraft = async (item: MenuItem) => {
    const { error } = await supabase
      .from('menu_items')
      .update({ status: 'draft', approved_by: null, approver_date: null })
      .eq('id', item.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Moved back to draft.')
    reload()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const { error } = await supabase.from('menu_items').delete().eq('id', deleting.id)
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setDeleting(null)
    toast.success('Menu item deleted.')
    reload()
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Menu planning</h1>
          <p className="text-sm text-slate-500">
            {visible.length} dish{visible.length === 1 ? '' : 'es'} · estimated {money(totalCost)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ShareButton
            text={() => menuMessage(visible)}
            label="Send menu"
            className="disabled:opacity-50"
          />
          <Button onClick={openCreate}>+ Suggest a dish</Button>
        </div>
      </header>

      {isHead && (counts.draft ?? 0) > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-2xl" aria-hidden>
            ⏳
          </span>
          <p className="flex-1 text-sm text-amber-900">
            <strong>{counts.draft}</strong> suggestion{counts.draft === 1 ? '' : 's'} waiting for
            your approval.
          </p>
          {tab !== 'draft' && (
            <Button size="sm" variant="secondary" onClick={() => setTab('draft')}>
              Review
            </Button>
          )}
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search dishes, cooks, notes…" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-none items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === t.key
                  ? 'bg-palm-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 ring-1 ring-inset ring-sand-200 hover:bg-sand-50'
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 text-xs font-bold ${
                  tab === t.key ? 'bg-white/20' : 'bg-sand-200 text-slate-600'
                }`}
              >
                {counts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading menu" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🍽️"
          title="Nothing on the menu here"
          description="Anyone in the family can suggest a dish. The head of family approves it, and the cooking task assigns itself."
          action={<Button onClick={openCreate}>+ Suggest a dish</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <MenuCard
              key={item.id}
              item={item}
              isHead={isHead}
              isMine={item.suggested_by === profile?.id}
              onApprove={() => void approve(item)}
              onReject={() => {
                setRejecting(item)
                setRejectReason('')
              }}
              onEdit={() => openEdit(item)}
              onDelete={() => setDeleting(item)}
              onBackToDraft={() => void backToDraft(item)}
            />
          ))}
        </div>
      )}

      {/* ----------------------------------------------------------- form */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit menu item' : 'Suggest a dish'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="menu-form" loading={saving}>
              {editing ? 'Save changes' : 'Send suggestion'}
            </Button>
          </>
        }
      >
        <form id="menu-form" onSubmit={save} className="space-y-4">
          <Field label="Dish name" required>
            <Input
              value={form.dish_name}
              onChange={(e) => setForm({ ...form, dish_name: e.target.value })}
              required
              placeholder="Chicken Biryani"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Meal">
              <Select
                value={form.meal_type}
                onChange={(e) => setForm({ ...form, meal_type: e.target.value as MealType })}
              >
                {MEAL_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {titleCase(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Serve date">
              <Input
                type="date"
                value={form.serve_date}
                onChange={(e) => setForm({ ...form, serve_date: e.target.value })}
              />
            </Field>
          </div>

          <Field label="For which visit?">
            <Select
              value={form.guest_id}
              onChange={(e) => setForm({ ...form, guest_id: e.target.value })}
            >
              <option value="">Not linked to a specific visit</option>
              {guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {fmtDate(g.arrival_date)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Homemade or bought outside?">
            <div className="grid grid-cols-2 gap-3">
              {(['homemade', 'outside'] as PrepType[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setForm({ ...form, homemade_or_outside: option })}
                  className={`rounded-xl border-2 px-4 py-3 text-sm font-bold transition ${
                    form.homemade_or_outside === option
                      ? 'border-palm-500 bg-palm-50 text-palm-800'
                      : 'border-sand-200 bg-white text-slate-600 hover:border-sand-300'
                  }`}
                >
                  {option === 'homemade' ? '🏠 Homemade' : '🛍️ Buy outside'}
                </button>
              ))}
            </div>
          </Field>

          {form.homemade_or_outside === 'homemade' ? (
            <Field label="Who will cook it?" hint="They get the task automatically once approved.">
              <Select
                value={form.cook_person}
                onChange={(e) => setForm({ ...form, cook_person: e.target.value })}
              >
                <option value="">Decide later</option>
                {cooks.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              label="Who is responsible for buying it?"
              hint="They get the pickup task automatically once approved."
            >
              <Select
                value={form.outside_responsible}
                onChange={(e) => setForm({ ...form, outside_responsible: e.target.value })}
              >
                <option value="">Decide later</option>
                {cooks.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantity">
              <Input
                type="number"
                min="0.25"
                step="0.25"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </Field>
            <Field label="Unit">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="serving">serving</option>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Est. cost">
              <Input
                type="number"
                min="0"
                step="1"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Medium spice, order from Al Romansiah…"
            />
          </Field>

          {!editing && !isHead && (
            <p className="rounded-xl bg-sand-100 px-4 py-3 text-xs text-slate-600">
              Your suggestion is saved as a <strong>DRAFT</strong> and is visible to everyone. Only
              the head of family can approve it.
            </p>
          )}
        </form>
      </Modal>

      {/* --------------------------------------------------------- reject */}
      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject "${rejecting?.dish_name ?? ''}"`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void reject()} loading={busy}>
              Reject
            </Button>
          </>
        }
      >
        <Field label="Reason (optional)" hint="Shown on the card so the suggester knows why.">
          <Textarea
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Too heavy for lunch — let's keep it for the weekend."
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete menu item"
        message={`Delete "${deleting?.dish_name}"? Any task created from it is deleted too.`}
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

function MenuCard({
  item,
  isHead,
  isMine,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  onBackToDraft,
}: {
  item: MenuItem
  isHead: boolean
  isMine: boolean
  onApprove: () => void
  onReject: () => void
  onEdit: () => void
  onDelete: () => void
  onBackToDraft: () => void
}) {
  const tone = menuTone(item.status)
  const accent = {
    gray: 'bg-slate-300',
    purple: 'bg-violet-500',
    blue: 'bg-sky-500',
    green: 'bg-emerald-500',
    red: 'bg-red-500',
    yellow: 'bg-amber-400',
  }[tone]

  const responsible = item.homemade_or_outside === 'outside' ? item.outsider : item.cook
  const canEdit = isHead || (isMine && item.status === 'draft')

  return (
    <Card accent={accent} className="flex flex-col p-5 pl-6">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-slate-800">{item.dish_name}</h3>
          <p className="text-xs text-slate-500">
            {titleCase(item.meal_type)}
            {item.serve_date ? ` · ${fmtDate(item.serve_date, 'EEE dd MMM')}` : ''}
          </p>
        </div>
        <Badge tone={tone}>{titleCase(item.status)}</Badge>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge tone={item.homemade_or_outside === 'homemade' ? 'green' : 'blue'}>
          {item.homemade_or_outside === 'homemade' ? '🏠 Homemade' : '🛍️ Buy outside'}
        </Badge>
        <Badge tone="gray">
          {qty(item.quantity)} {item.unit}
        </Badge>
        <Badge tone="gray">{money(item.cost)}</Badge>
      </div>

      <dl className="mb-3 space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <dt className="w-24 flex-none text-slate-500">Suggested by</dt>
          <dd className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-700">
            {item.suggester?.name && <Avatar name={item.suggester.name} size="sm" />}
            <span className="truncate">{item.suggester?.name ?? 'Unknown'}</span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-24 flex-none text-slate-500">
            {item.homemade_or_outside === 'outside' ? 'Buying' : 'Cooking'}
          </dt>
          <dd className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-700">
            {responsible?.name ? (
              <>
                <Avatar name={responsible.name} size="sm" />
                <span className="truncate">{responsible.name}</span>
              </>
            ) : (
              <span className="text-slate-400">Not assigned yet</span>
            )}
          </dd>
        </div>
        {item.guest?.name && (
          <div className="flex items-center gap-2">
            <dt className="w-24 flex-none text-slate-500">For</dt>
            <dd className="truncate font-semibold text-slate-700">{item.guest.name}</dd>
          </div>
        )}
        {item.approver?.name && item.status !== 'draft' && (
          <div className="flex items-center gap-2">
            <dt className="w-24 flex-none text-slate-500">
              {item.status === 'rejected' ? 'Rejected by' : 'Approved by'}
            </dt>
            <dd className="truncate font-semibold text-slate-700">{item.approver.name}</dd>
          </div>
        )}
      </dl>

      {item.notes && (
        <p className="mb-3 rounded-xl bg-sand-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          {item.notes}
        </p>
      )}

      {item.status === 'rejected' && item.rejection_reason && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
          <span className="font-bold">Reason: </span>
          {item.rejection_reason}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-sand-100 pt-3">
        {isHead && item.status === 'draft' && (
          <>
            <Button size="sm" variant="success" onClick={onApprove}>
              ✓ Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={onReject}>
              Reject
            </Button>
          </>
        )}
        {isHead && item.status === 'rejected' && (
          <Button size="sm" variant="secondary" onClick={onBackToDraft}>
            ↩ Reconsider
          </Button>
        )}
        {canEdit && (
          <button
            onClick={onEdit}
            className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
          >
            ✏ Edit
          </button>
        )}
        {canEdit && (
          <button
            onClick={onDelete}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        )}
        {item.status === 'approved' && (
          <span className="ml-auto self-center text-[10px] font-semibold text-emerald-600">
            ✓ Task created
          </span>
        )}
      </div>
    </Card>
  )
}
