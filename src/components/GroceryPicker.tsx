import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { qty as fmtQty } from '../lib/format'
import { Badge, Button, Card, EmptyState, SearchBar, Spinner } from './ui'
import type { GroceryItem } from '../lib/types'

/** A catalogue row plus the shopping entry this person has open for it. */
interface Picked {
  rowId: string
  quantity: number
  unit: string
}

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

/**
 * The family-facing grocery list: tick what you need, set how much.
 *
 * A tick writes an ordinary shopping_list row owned by you, so it merges into
 * the driver's consolidated list exactly like a typed-in item — two people
 * ticking Chicken still produces one line with the totals added up.
 */
export function GroceryPicker({ onChanged }: { onChanged: () => void }) {
  const { profile } = useAuth()
  const toast = useToast()

  const [catalogue, setCatalogue] = useState<GroceryItem[]>([])
  const [picked, setPicked] = useState<Record<string, Picked>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  /** Ids currently mid-write, so a double tap cannot double-insert. */
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!profile) return
    const [cat, mine] = await Promise.all([
      supabase
        .from('grocery_catalogue')
        .select('*')
        .eq('is_active', true)
        .order('category')
        .order('sort_order'),
      supabase
        .from('shopping_list')
        .select('id, catalogue_id, quantity, unit')
        .eq('added_by', profile.id)
        .eq('status', 'pending')
        .not('catalogue_id', 'is', null),
    ])

    setCatalogue((cat.data ?? []) as unknown as GroceryItem[])

    const map: Record<string, Picked> = {}
    for (const row of (mine.data ?? []) as unknown as {
      id: string
      catalogue_id: string
      quantity: number
      unit: string
    }[]) {
      map[row.catalogue_id] = { rowId: row.id, quantity: Number(row.quantity), unit: row.unit }
    }
    setPicked(map)
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const byCategory = new Map<string, GroceryItem[]>()

    for (const item of catalogue) {
      if (term && !item.name.toLowerCase().includes(term)) continue
      const list = byCategory.get(item.category) ?? []
      list.push(item)
      byCategory.set(item.category, list)
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [catalogue, search])

  const pickedCount = Object.keys(picked).length

  // ------------------------------------------------------------------ actions
  const tick = async (item: GroceryItem) => {
    if (busy[item.id]) return
    setBusy((b) => ({ ...b, [item.id]: true }))

    const { data, error } = await supabase
      .from('shopping_list')
      .insert({
        item_name: item.name,
        quantity: item.default_qty,
        unit: item.default_unit,
        category: item.category,
        catalogue_id: item.id,
        added_by: profile?.id,
      })
      .select('id')
      .single()

    setBusy((b) => ({ ...b, [item.id]: false }))
    if (error) {
      toast.error(errorMessage(error))
      return
    }

    const id = (data as unknown as { id?: string } | null)?.id
    if (!id) {
      toast.error('Could not add that item — please try again.')
      return
    }

    // Use the values we just sent rather than reading them back: we already
    // know them, and it keeps the tick immune to how numerics round-trip.
    setPicked((p) => ({
      ...p,
      [item.id]: { rowId: id, quantity: Number(item.default_qty), unit: item.default_unit },
    }))
    onChanged()
  }

  const untick = async (item: GroceryItem) => {
    const entry = picked[item.id]
    if (!entry || busy[item.id]) return
    setBusy((b) => ({ ...b, [item.id]: true }))

    const { error } = await supabase.from('shopping_list').delete().eq('id', entry.rowId)

    setBusy((b) => ({ ...b, [item.id]: false }))
    if (error) {
      toast.error(errorMessage(error))
      return
    }

    setPicked((p) => {
      const next = { ...p }
      delete next[item.id]
      return next
    })
    onChanged()
  }

  const changeQty = async (item: GroceryItem, delta: number) => {
    const entry = picked[item.id]
    if (!entry) return

    const step = entry.unit === 'kg' || entry.unit === 'litre' ? 0.5 : 1
    const next = Math.round((entry.quantity + delta * step) * 100) / 100

    if (next <= 0) {
      await untick(item)
      return
    }

    // optimistic: the stepper must feel instant
    setPicked((p) => ({ ...p, [item.id]: { ...entry, quantity: next } }))

    const { error } = await supabase
      .from('shopping_list')
      .update({ quantity: next })
      .eq('id', entry.rowId)

    if (error) {
      setPicked((p) => ({ ...p, [item.id]: entry }))
      toast.error(errorMessage(error))
      return
    }
    onChanged()
  }

  const clearMine = async () => {
    const ids = Object.values(picked).map((p) => p.rowId)
    if (ids.length === 0) return

    const { error } = await supabase.from('shopping_list').delete().in('id', ids)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setPicked({})
    toast.success('Your ticked items were cleared.')
    onChanged()
  }

  if (loading) return <Spinner label="Loading grocery list" />

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar value={search} onChange={setSearch} placeholder="Find an item…" />
        {pickedCount > 0 && (
          <Button variant="secondary" onClick={() => void clearMine()}>
            Clear my {pickedCount}
          </Button>
        )}
      </div>

      {pickedCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-palm-200 bg-palm-50 px-4 py-3">
          <span className="text-2xl" aria-hidden>
            🛒
          </span>
          <p className="flex-1 text-sm text-palm-900">
            You have ticked <strong>{pickedCount}</strong> item{pickedCount === 1 ? '' : 's'}. They
            are already on the driver's list.
          </p>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No items match"
          description="Try a different word, or add a one-off item with the “+ Add item” button."
        />
      ) : (
        <div className="space-y-4">
          {groups.map(([category, items]) => {
            const chosen = items.filter((i) => picked[i.id]).length
            const isCollapsed = collapsed[category] && !search

            return (
              <Card key={category} className="overflow-hidden">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}
                  className="flex w-full items-center gap-3 border-b border-sand-100 bg-sand-50/60 px-4 py-3 text-left transition hover:bg-sand-100"
                >
                  <span className="text-xl" aria-hidden>
                    {CATEGORY_ICON[category] ?? '🛒'}
                  </span>
                  <span className="flex-1 font-bold text-slate-800">{category}</span>
                  {chosen > 0 && <Badge tone="green">{chosen} ticked</Badge>}
                  <span className="text-xs text-slate-400">{items.length}</span>
                  <span
                    className={`text-slate-400 transition ${isCollapsed ? '' : 'rotate-90'}`}
                    aria-hidden
                  >
                    ▶
                  </span>
                </button>

                {!isCollapsed && (
                  <ul className="divide-y divide-sand-100">
                    {items.map((item) => {
                      const entry = picked[item.id]
                      const on = Boolean(entry)

                      return (
                        <li
                          key={item.id}
                          className={`flex items-center gap-3 px-4 py-2.5 transition ${
                            on ? 'bg-palm-50/50' : ''
                          }`}
                        >
                          <button
                            onClick={() => (on ? void untick(item) : void tick(item))}
                            disabled={busy[item.id]}
                            className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg text-lg font-bold transition disabled:opacity-50 ${
                              on
                                ? 'bg-palm-600 text-white'
                                : 'bg-sand-100 text-transparent hover:bg-palm-100 hover:text-palm-600'
                            }`}
                            aria-label={on ? `Remove ${item.name}` : `Add ${item.name}`}
                            aria-pressed={on}
                          >
                            ✓
                          </button>

                          <span
                            className={`flex-1 text-sm ${
                              on ? 'font-semibold text-slate-800' : 'text-slate-600'
                            }`}
                          >
                            {item.name}
                          </span>

                          {on ? (
                            <span className="flex flex-none items-center gap-1">
                              <button
                                onClick={() => void changeQty(item, -1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-sand-100 text-lg font-bold text-slate-600 transition hover:bg-sand-200"
                                aria-label={`Less ${item.name}`}
                              >
                                −
                              </button>
                              <span className="min-w-[4.5rem] text-center text-sm font-bold text-slate-800">
                                {fmtQty(entry.quantity)} {entry.unit}
                              </span>
                              <button
                                onClick={() => void changeQty(item, 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-sand-100 text-lg font-bold text-slate-600 transition hover:bg-sand-200"
                                aria-label={`More ${item.name}`}
                              >
                                +
                              </button>
                            </span>
                          ) : (
                            <span className="flex-none text-xs text-slate-400">
                              {fmtQty(item.default_qty)} {item.default_unit}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
