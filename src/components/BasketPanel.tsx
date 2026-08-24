import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { qty as fmtQty } from '../lib/format'
import { STORES } from '../lib/types'
import { Button, Card, EmptyState, Input, Select, Spinner } from './ui'
import type { ShoppingItem } from '../lib/types'

const CATEGORY_ICON: Record<string, string> = {
  Vegetables: '🥬',
  Fruits: '🍎',
  Meat: '🥩',
  Fish: '🐟',
  Dairy: '🥛',
  Grains: '🌾',
  Spices: '🧂',
  Bakery: '🍞',
  Beverages: '🧃',
  Frozen: '🧊',
  Household: '🧽',
  Other: '🛒',
}

const NO_STORE = 'Any shop'

/**
 * Your basket: everything you have ticked but not yet sent.
 *
 * This is the review step before the order goes out — set how much, say which
 * shop each thing comes from, then send the lot in one go. Until you press
 * send, nobody else can see any of it.
 */
export function BasketPanel({
  onSent,
  onBrowse,
}: {
  onSent: () => void
  onBrowse: () => void
}) {
  const { profile } = useAuth()
  const toast = useToast()

  const [rows, setRows] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  /** Ids being written right now, so a double tap cannot double-apply. */
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!profile) return
    const { data, error } = await supabase
      .from('shopping_list')
      .select('*')
      .eq('added_by', profile.id)
      .is('submitted_at', null)
      .order('category')
      .order('item_name')

    if (error) toast.error(errorMessage(error))
    setRows((data ?? []) as unknown as ShoppingItem[])
    setLoading(false)
  }, [profile, toast])

  useEffect(() => {
    void load()
  }, [load])

  /** Shops already in use, so the family's real habits lead the list. */
  const storeOptions = useMemo(() => {
    const used = rows.map((r) => r.store).filter((s): s is string => Boolean(s?.trim()))
    return [...new Set([...used, ...STORES])].sort()
  }, [rows])

  const groups = useMemo(() => {
    const byStore = new Map<string, ShoppingItem[]>()
    for (const row of rows) {
      const key = row.store?.trim() || NO_STORE
      byStore.set(key, [...(byStore.get(key) ?? []), row])
    }
    return [...byStore.entries()].sort(([a], [b]) =>
      a === NO_STORE ? 1 : b === NO_STORE ? -1 : a.localeCompare(b),
    )
  }, [rows])

  // ------------------------------------------------------------------ actions
  const patch = async (row: ShoppingItem, changes: Partial<ShoppingItem>) => {
    if (busy[row.id]) return
    setBusy((b) => ({ ...b, [row.id]: true }))

    // optimistic: a stepper or a dropdown has to feel instant
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...changes } : r)))

    const { error } = await supabase.from('shopping_list').update(changes).eq('id', row.id)
    setBusy((b) => ({ ...b, [row.id]: false }))

    if (error) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? row : r)))
      toast.error(errorMessage(error))
    }
  }

  const changeQty = async (row: ShoppingItem, delta: number) => {
    const step = row.unit === 'kg' || row.unit === 'litre' ? 0.5 : 1
    const next = Math.round((Number(row.quantity) + delta * step) * 100) / 100
    if (next <= 0) {
      await remove(row)
      return
    }
    await patch(row, { quantity: next })
  }

  const remove = async (row: ShoppingItem) => {
    const { error } = await supabase.from('shopping_list').delete().eq('id', row.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setRows((rs) => rs.filter((r) => r.id !== row.id))
  }

  const clearAll = async () => {
    const { error } = await supabase
      .from('shopping_list')
      .delete()
      .eq('added_by', profile?.id ?? '')
      .is('submitted_at', null)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setRows([])
    toast.success('Basket emptied.')
  }

  const send = async () => {
    setSending(true)
    const { data, error } = await supabase.rpc('submit_my_basket')
    setSending(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    const count = Number(data ?? 0)
    if (count === 0) {
      toast.error('There was nothing to send.')
      return
    }
    setRows([])
    toast.success(`${count} item${count === 1 ? '' : 's'} sent to the driver.`)
    onSent()
  }

  if (loading) return <Spinner label="Loading your basket" />

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="🧺"
        title="Your basket is empty"
        description="Tick what you need on the Grocery tab, set the shops here, then send it all to the driver in one go."
        action={<Button onClick={onBrowse}>Browse the grocery list</Button>}
      />
    )
  }

  const missingStore = rows.filter((r) => !r.store?.trim()).length

  return (
    <div>
      {/* ------------------------------------------------------------ summary */}
      <Card className="mb-4 flex flex-wrap items-center gap-3 border-palm-200 bg-palm-50 p-4">
        <span className="text-2xl" aria-hidden>
          🧺
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-palm-900">
            {rows.length} item{rows.length === 1 ? '' : 's'} ready to send
          </p>
          <p className="text-xs text-palm-800">
            {missingStore > 0
              ? `${missingStore} without a shop — the driver will decide where to buy those.`
              : 'Every item says where to buy it.'}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void clearAll()}>
          Empty basket
        </Button>
        <Button loading={sending} onClick={() => void send()}>
          Send to driver
        </Button>
      </Card>

      {/* -------------------------------------------------- items, by shop */}
      <div className="space-y-4">
        {groups.map(([store, group]) => (
          <Card key={store} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-sand-100 bg-sand-50/60 px-4 py-3">
              <span className="text-lg" aria-hidden>
                🏪
              </span>
              <span className="flex-1 font-bold text-slate-800">{store}</span>
              <span className="text-xs text-slate-400">{group.length}</span>
            </div>

            <ul className="divide-y divide-sand-100">
              {group.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="text-lg" aria-hidden>
                    {CATEGORY_ICON[row.category] ?? '🛒'}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
                    {row.item_name}
                  </span>

                  <span className="flex flex-none items-center gap-1">
                    <button
                      onClick={() => void changeQty(row, -1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-sand-100 text-lg font-bold text-slate-600 transition hover:bg-sand-200"
                      aria-label={`Less ${row.item_name}`}
                    >
                      −
                    </button>
                    <span className="min-w-[4.5rem] text-center text-sm font-bold text-slate-800">
                      {fmtQty(row.quantity)} {row.unit}
                    </span>
                    <button
                      onClick={() => void changeQty(row, 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-sand-100 text-lg font-bold text-slate-600 transition hover:bg-sand-200"
                      aria-label={`More ${row.item_name}`}
                    >
                      +
                    </button>
                  </span>

                  <Select
                    value={row.store ?? ''}
                    onChange={(e) => void patch(row, { store: e.target.value || null })}
                    className="w-36 flex-none"
                    aria-label={`Shop for ${row.item_name}`}
                  >
                    <option value="">{NO_STORE}</option>
                    {storeOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>

                  <button
                    onClick={() => void remove(row)}
                    className="flex-none rounded-lg px-2 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50"
                    aria-label={`Remove ${row.item_name}`}
                  >
                    Remove
                  </button>

                  <Input
                    value={row.notes ?? ''}
                    onChange={(e) => void patch(row, { notes: e.target.value || null })}
                    placeholder="Note for the driver — brand, size, ripeness…"
                    className="w-full text-xs"
                  />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
