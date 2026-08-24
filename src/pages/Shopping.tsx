import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import { fmtDate, priorityTone, qty, shopTone, titleCase, todayISO } from '../lib/format'
import { downloadCsv } from '../lib/export'
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
import { GroceryPicker } from '../components/GroceryPicker'
import { BasketPanel } from '../components/BasketPanel'
import { DriverList } from '../components/DriverList'
import { SHOPPING_CATEGORIES, STORES, UNITS } from '../lib/types'
import { ShareButton } from '../components/ShareButton'
import { shoppingMessage } from '../lib/whatsapp'
import type { ConsolidatedItem, Guest, Priority, ShoppingItem } from '../lib/types'

interface SimilarItem {
  id: string
  item_name: string
  quantity: number
  unit: string
  category: string
  added_by_name: string | null
  score: number
}

type View = 'grocery' | 'basket' | 'list' | 'detail'

const EMPTY = {
  item_name: '',
  quantity: '1',
  unit: 'kg',
  category: 'Vegetables',
  store: '',
  priority: 'medium' as Priority,
  notes: '',
  guest_id: '',
}

export function ShoppingPage() {
  const { profile, isDriver, isHead, isFamily } = useAuth()
  const toast = useToast()
  const [tick, reload] = useReload()

  // Family land on the tick list — that is the everyday action. The driver
  // only ever gets their own grouped list.
  const [view, setView] = useState<View>(isDriver ? 'list' : 'grocery')
  /** How many things are sitting in my basket, unsent. */
  const [basketCount, setBasketCount] = useState(0)
  const [consolidated, setConsolidated] = useState<ConsolidatedItem[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [hidePurchased, setHidePurchased] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [similar, setSimilar] = useState<SimilarItem[]>([])
  const [deleting, setDeleting] = useState<ShoppingItem | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    // Deliberately not flipping `loading` back on for refetches: a reload runs
    // after every grocery tick, and showing the spinner again would unmount the
    // tick list, losing scroll position, collapsed sections and local state.

    // The driver may only read the consolidated view, so the per-person rows
    // and the guest list are fetched for family roles only.
    const load = async () => {
      const conRes = await supabase
        .from('shopping_consolidated')
        .select('*')
        .order('category')
        .order('item_name')

      if (!active) return
      if (conRes.error) toast.error(errorMessage(conRes.error))
      setConsolidated((conRes.data ?? []) as unknown as ConsolidatedItem[])

      if (isFamily) {
        const { count } = await supabase
          .from('shopping_list')
          .select('id', { count: 'exact', head: true })
          .eq('added_by', profile?.id ?? '')
          .is('submitted_at', null)
        if (!active) return
        setBasketCount(count ?? 0)

        const [itemRes, guestRes] = await Promise.all([
          supabase
            .from('shopping_list')
            .select('*, adder:users!shopping_list_added_by_fkey(id, name)')
            .order('created_at', { ascending: false }),
          supabase.from('guests').select('*').order('arrival_date'),
        ])
        if (!active) return
        setItems((itemRes.data ?? []) as unknown as ShoppingItem[])
        setGuests((guestRes.data ?? []) as unknown as Guest[])
      }

      setLoading(false)
    }

    void load()

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, isFamily, profile?.id])

  // ----------------------------------------------------- duplicate detection
  const checkDuplicates = useCallback(async (name: string) => {
    if (name.trim().length < 2) {
      setSimilar([])
      return
    }
    const { data } = await supabase.rpc('find_similar_shopping_items', { p_name: name.trim() })
    setSimilar((data ?? []) as SimilarItem[])
  }, [])

  useEffect(() => {
    if (!formOpen) return
    const timer = window.setTimeout(() => void checkDuplicates(form.item_name), 350)
    return () => window.clearTimeout(timer)
  }, [form.item_name, formOpen, checkDuplicates])

  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = consolidated.filter((row) => {
      if (hidePurchased && row.status !== 'pending') return false
      if (!term) return true
      return (
        row.item_name.toLowerCase().includes(term) || row.category.toLowerCase().includes(term)
      )
    })

    const byCategory = new Map<string, ConsolidatedItem[]>()
    filtered.forEach((row) => {
      const list = byCategory.get(row.category) ?? []
      list.push(row)
      byCategory.set(row.category, list)
    })
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [consolidated, search, hidePurchased])

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((item) => {
      // The basket has its own tab; this list is what has actually gone out.
      if (!item.submitted_at) return false
      if (hidePurchased && item.status !== 'pending') return false
      if (!term) return true
      return [item.item_name, item.category, item.store, item.adder?.name, item.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    })
  }, [items, search, hidePurchased])

  const stats = useMemo(() => {
    const pending = consolidated.filter((c) => c.status === 'pending')
    const merged = consolidated.filter((c) => c.entry_count > 1)
    return {
      pending: pending.length,
      total: consolidated.length,
      merged: merged.length,
      mergedSaved: merged.reduce((sum, c) => sum + c.entry_count - 1, 0),
    }
  }, [consolidated])

  // --------------------------------------------------------------- mutations
  const addItem = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('shopping_list').insert({
      item_name: form.item_name.trim(),
      quantity: Number(form.quantity) || 1,
      unit: form.unit,
      category: form.category,
      store: form.store.trim() || null,
      priority: form.priority,
      notes: form.notes.trim() || null,
      guest_id: form.guest_id || null,
      added_by: profile?.id,
    })
    setSaving(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }

    const merged = similar.find(
      (s) => s.item_name.trim().toLowerCase() === form.item_name.trim().toLowerCase(),
    )
    toast.success(
      merged
        ? `Added to your basket. It will merge with ${merged.added_by_name ?? 'another'} entry when you send it.`
        : 'Added to your basket. Send it when you are ready.',
    )

    setForm({ ...EMPTY, category: form.category, unit: form.unit, store: form.store })
    setSimilar([])
    setFormOpen(false)
    reload()
  }

  const setGroupStatus = async (group: ConsolidatedItem, status: 'pending' | 'purchased' | 'verified') => {
    const { error } = await supabase.rpc('set_shopping_status', {
      p_ids: group.source_ids,
      p_status: status,
    })
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(
      status === 'pending'
        ? `${group.item_name} moved back to pending.`
        : `${group.item_name} marked ${status}.`,
    )
    reload()
  }

  const setItemStatus = async (item: ShoppingItem, status: 'pending' | 'purchased' | 'verified') => {
    const { error } = await supabase.from('shopping_list').update({ status }).eq('id', item.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    reload()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    const { error } = await supabase.from('shopping_list').delete().eq('id', deleting.id)
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setDeleting(null)
    toast.success('Item removed.')
    reload()
  }

  const exportCsv = () => {
    downloadCsv(
      `shopping-list-${todayISO()}.csv`,
      ['Category', 'Item', 'Quantity', 'Unit', 'Shop', 'Status', 'Priority', 'Requested by'],
      visibleGroups.flatMap(([category, rows]) =>
        rows.map((r) => [
          category,
          r.item_name,
          qty(r.total_quantity),
          r.unit,
          r.store,
          r.status,
          r.priority,
          (r.contributors ?? []).join(', '),
        ]),
      ),
    )
    toast.success('Shopping list exported.')
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* ------------------------------------------------- printable header */}
      <div className="print-only mb-4 border-b-2 border-slate-800 pb-3">
        <h1 className="text-2xl font-extrabold">SS Family — Shopping List</h1>
        <p className="text-sm">Printed {fmtDate(todayISO())}</p>
      </div>

      <header className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            {isDriver ? 'Shopping list' : 'Shopping'}
          </h1>
          <p className="text-sm text-slate-500">
            {stats.pending} item{stats.pending === 1 ? '' : 's'} to buy
            {stats.merged > 0 && (
              <span className="text-palm-700">
                {' '}
                · {stats.merged} consolidated from {stats.merged + stats.mergedSaved} entries
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            🖨 Print
          </Button>
          <ShareButton
            text={() => shoppingMessage(consolidated.filter((c) => c.status === 'pending'))}
            label="Send list"
          />
          {isFamily && (
            <>
              <Button variant="secondary" onClick={exportCsv} disabled={consolidated.length === 0}>
                ⬇ Export
              </Button>
              <Button
                onClick={() => {
                  setForm({ ...EMPTY })
                  setSimilar([])
                  setFormOpen(true)
                }}
              >
                + Add item
              </Button>
            </>
          )}
        </div>
      </header>

      {isDriver && (
        <div className="no-print mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
          <span className="text-2xl" aria-hidden>
            🚗
          </span>
          <p className="text-sm text-sky-900">
            Three ways to read the same list: <strong>by shop</strong> for the trip,{' '}
            <strong>merged totals</strong> for the counter, and <strong>by person</strong> so you
            know whose bag each thing goes in. Tick items off as you buy them.
          </p>
        </div>
      )}

      {!isDriver && (
      <div className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar value={search} onChange={setSearch} placeholder="Search items…" />
        <label className="flex items-center gap-2.5 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-600 ring-1 ring-inset ring-sand-200">
          <input
            type="checkbox"
            checked={hidePurchased}
            onChange={(e) => setHidePurchased(e.target.checked)}
            className="h-4 w-4 rounded border-sand-300 text-palm-600 focus:ring-palm-500"
          />
          Hide purchased
        </label>
      </div>
      )}

      {isFamily && (
        <div className="no-print mb-5 flex rounded-xl bg-sand-100 p-1">
          {(
            [
              ['grocery', '🥕 Grocery'],
              ['basket', `🧺 My basket${basketCount > 0 ? ` (${basketCount})` : ''}`],
              ['list', isHead ? "🚗 Driver's list" : '📤 Sent'],
              ['detail', isHead ? '👥 Every entry' : '📋 My items'],
            ] as [View, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex-1 rounded-lg px-2 py-2.5 text-xs font-bold transition sm:text-sm ${
                view === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              } ${key === 'basket' && basketCount > 0 ? 'text-palm-700' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Spinner label="Loading list" />
      ) : view === 'grocery' ? (
        <GroceryPicker onChanged={reload} />
      ) : view === 'basket' ? (
        <BasketPanel
          onSent={() => {
            setView('list')
            reload()
          }}
          onBrowse={() => setView('grocery')}
        />
      ) : view === 'list' && isDriver ? (
        <DriverList canPurchase />
      ) : view === 'list' ? (
        visibleGroups.length === 0 ? (
          <EmptyState
            icon="🛒"
            title="Nothing to buy"
            description={
              hidePurchased && consolidated.length > 0
                ? 'Everything on the list has been purchased.'
                : 'Family members can add what they need and it all merges into one list.'
            }
          />
        ) : (
          <div className="space-y-5">
            {visibleGroups.map(([category, rows]) => (
              <section key={category} className="print-break">
                <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-500">
                  {category}
                  <span className="rounded-full bg-sand-200 px-2 py-0.5 text-xs text-slate-600">
                    {rows.length}
                  </span>
                </h2>
                <div className="space-y-2">
                  {rows.map((row) => (
                    <ConsolidatedRow
                      key={`${row.normalized_name}-${row.unit}-${row.category}`}
                      row={row}
                      canVerify={isHead}
                      onStatus={(status) => void setGroupStatus(row, status)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : visibleItems.length === 0 ? (
        <EmptyState icon="📝" title="No individual entries" />
      ) : (
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <Card key={item.id} className="flex flex-wrap items-center gap-3 p-3.5">
              <span className="flex-1 truncate">
                <span
                  className={`font-semibold ${
                    item.status === 'pending' ? 'text-slate-800' : 'text-slate-400 line-through'
                  }`}
                >
                  {item.item_name}
                </span>
                <span className="ml-2 text-sm text-slate-500">
                  {qty(item.quantity)} {item.unit}
                </span>
                {item.notes && (
                  <span className="block truncate text-xs text-slate-400">{item.notes}</span>
                )}
              </span>
              <Badge tone="gray">{item.category}</Badge>
              <Badge tone={priorityTone(item.priority)}>{titleCase(item.priority)}</Badge>
              <Badge tone={shopTone(item.status)}>{titleCase(item.status)}</Badge>
              {item.adder?.name && (
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Avatar name={item.adder.name} size="sm" />
                  {item.adder.name}
                </span>
              )}
              {item.status === 'pending' && (
                <button
                  onClick={() => void setItemStatus(item, 'purchased')}
                  className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                >
                  ✓ Bought
                </button>
              )}
              {(isHead || item.added_by === profile?.id) && item.status === 'pending' && (
                <button
                  onClick={() => setDeleting(item)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50"
                >
                  ✕
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------- form */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add to the shopping list"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="shop-form" loading={saving}>
              Add item
            </Button>
          </>
        }
      >
        <form id="shop-form" onSubmit={addItem} className="space-y-4">
          <Field label="Item name" required>
            <Input
              value={form.item_name}
              onChange={(e) => setForm({ ...form, item_name: e.target.value })}
              required
              autoFocus
              placeholder="Chicken"
            />
          </Field>

          {similar.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-900">
                <span aria-hidden>🔁</span> Already on the list
              </p>
              <ul className="space-y-1 text-xs text-amber-900">
                {similar.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>
                      <strong>{s.item_name}</strong> — {qty(s.quantity)} {s.unit}
                      {s.added_by_name ? ` (${s.added_by_name})` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          item_name: s.item_name,
                          unit: s.unit,
                          category: s.category,
                        })
                      }
                      className="flex-none rounded-md bg-amber-200/70 px-2 py-0.5 font-bold transition hover:bg-amber-300"
                    >
                      match it
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-amber-800">
                Add it anyway — identical names in the same unit and category are merged into a
                single line on the driver's list, and everyone keeps credit for their request.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity" required>
              <Input
                type="number"
                min="0.25"
                step="0.25"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                required
              />
            </Field>
            <Field label="Unit">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {SHOPPING_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Which shop?" hint="Leave blank and the driver decides.">
              <Input
                value={form.store}
                onChange={(e) => setForm({ ...form, store: e.target.value })}
                list="store-options"
                placeholder="Bindawood, Panda…"
              />
              <datalist id="store-options">
                {STORES.map((st) => (
                  <option key={st} value={st} />
                ))}
              </datalist>
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

          <Field label="For which visit?">
            <Select
              value={form.guest_id}
              onChange={(e) => setForm({ ...form, guest_id: e.target.value })}
            >
              <option value="">General</option>
              {guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note for the driver">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Fresh, not frozen"
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Remove item"
        message={`Remove "${deleting?.item_name}" from the list?`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function ConsolidatedRow({
  row,
  canVerify,
  onStatus,
}: {
  row: ConsolidatedItem
  canVerify: boolean
  onStatus: (status: 'pending' | 'purchased' | 'verified') => void
}) {
  const pending = row.status === 'pending'
  const accent =
    row.status === 'verified'
      ? 'bg-emerald-500'
      : row.status === 'purchased'
        ? 'bg-sky-500'
        : row.priority === 'high'
          ? 'bg-red-500'
          : row.priority === 'medium'
            ? 'bg-amber-400'
            : 'bg-slate-300'

  return (
    <Card accent={accent} className="print-sheet flex flex-wrap items-center gap-3 p-3.5 pl-5">
      <button
        onClick={() => onStatus(pending ? 'purchased' : 'pending')}
        className={`no-print flex h-9 w-9 flex-none items-center justify-center rounded-lg text-lg transition ${
          pending
            ? 'bg-sand-100 text-transparent hover:bg-emerald-100 hover:text-emerald-600'
            : 'bg-emerald-100 text-emerald-700'
        }`}
        aria-label={pending ? `Mark ${row.item_name} purchased` : `Mark ${row.item_name} pending`}
      >
        ✓
      </button>

      {/* print-only checkbox */}
      <span className="print-only h-5 w-5 flex-none border-2 border-slate-700" aria-hidden />

      <span className="min-w-0 flex-1">
        <span
          className={`block font-bold ${pending ? 'text-slate-800' : 'text-slate-400 line-through'}`}
        >
          {row.item_name}
        </span>
        {row.entry_count > 1 && (
          <span className="no-print block text-[11px] text-palm-700">
            merged from {row.entry_count} requests · {(row.contributors ?? []).join(', ')}
          </span>
        )}
        {row.notes && <span className="block truncate text-xs text-slate-400">{row.notes}</span>}
      </span>

      <span className="flex-none rounded-lg bg-sand-100 px-3 py-1.5 text-sm font-extrabold text-slate-800">
        {qty(row.total_quantity)} {row.unit}
      </span>

      <span className="no-print flex flex-none items-center gap-2">
        <Badge tone={row.store === 'Any shop' ? 'gray' : 'blue'}>🏪 {row.store}</Badge>
        {row.priority === 'high' && pending && <Badge tone="red">Urgent</Badge>}
        <Badge tone={shopTone(row.status)}>{titleCase(row.status)}</Badge>
        {canVerify && row.status === 'purchased' && (
          <button
            onClick={() => onStatus('verified')}
            className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
          >
            Verify
          </button>
        )}
      </span>
    </Card>
  )
}
