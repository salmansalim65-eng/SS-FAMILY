import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { qty as fmtQty, relativeTime } from '../lib/format'
import { shareToWhatsApp } from '../lib/whatsapp'
import { Badge, Button, Card, EmptyState, SearchBar, Spinner } from './ui'
import type { DriverItem } from '../lib/types'

type GroupBy = 'store' | 'person' | 'item'

const TABS: { key: GroupBy; label: string; icon: string; hint: string }[] = [
  { key: 'store', label: 'By shop', icon: '🏪', hint: 'One trip per shop' },
  { key: 'person', label: 'By person', icon: '👤', hint: 'Who each item is for' },
  { key: 'item', label: 'Merged totals', icon: '🧾', hint: 'How much to buy in total' },
]

/**
 * The driver's list.
 *
 * The same items, sliced three ways, because the driver needs different
 * answers at different moments: what to buy at this shop, how much of a thing
 * in total at the counter, and — back home — whose bag each item goes into.
 */
export function DriverList({ canPurchase }: { canPurchase: boolean }) {
  const toast = useToast()

  const [rows, setRows] = useState<DriverItem[]>([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<GroupBy>('store')
  const [search, setSearch] = useState('')
  const [hideDone, setHideDone] = useState(true)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('shopping_for_driver')
      .select('*')
      .order('store')
      .order('category')
      .order('item_name')

    if (error) toast.error(errorMessage(error))
    setRows((data ?? []) as unknown as DriverItem[])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (hideDone && r.status !== 'pending') return false
      if (!term) return true
      return [r.item_name, r.store, r.requested_by, r.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    })
  }, [rows, search, hideDone])

  /** Grouped for display; the "item" mode also sums quantities. */
  const groups = useMemo(() => {
    if (groupBy === 'item') {
      const merged = new Map<string, { rows: DriverItem[]; total: number }>()
      for (const r of visible) {
        // Same thing in the same unit from the same shop is one line at the till.
        const key = `${r.item_name.toLowerCase()}|${r.unit}|${r.store}`
        const entry = merged.get(key) ?? { rows: [], total: 0 }
        entry.rows.push(r)
        entry.total += Number(r.quantity)
        merged.set(key, entry)
      }
      return [...merged.values()].sort((a, b) =>
        a.rows[0].item_name.localeCompare(b.rows[0].item_name),
      )
    }

    const by = new Map<string, DriverItem[]>()
    for (const r of visible) {
      const key = groupBy === 'store' ? r.store : r.requested_by
      by.set(key, [...(by.get(key) ?? []), r])
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visible, groupBy])

  const pending = rows.filter((r) => r.status === 'pending').length

  // ------------------------------------------------------------------ actions
  const setStatus = async (ids: string[], status: 'pending' | 'purchased') => {
    const key = ids.join(',')
    if (busy[key]) return
    setBusy((b) => ({ ...b, [key]: true }))

    const patch =
      status === 'purchased'
        ? { status, purchased_at: new Date().toISOString() }
        : { status, purchased_at: null, purchased_by: null }

    const { error } = await supabase.from('shopping_list').update(patch).in('id', ids)
    setBusy((b) => ({ ...b, [key]: false }))

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setRows((rs) =>
      rs.map((r) => (ids.includes(r.id) ? { ...r, status: status as DriverItem['status'] } : r)),
    )
  }

  const shareGroup = (label: string, group: DriverItem[]) => {
    const lines = [`*${label}*`, '']
    for (const r of group) {
      lines.push(
        `• ${r.item_name} — ${fmtQty(r.quantity)} ${r.unit}` +
          (groupBy === 'store' ? ` (${r.requested_by})` : ` — ${r.store}`) +
          (r.notes ? `\n   ↳ ${r.notes}` : ''),
      )
    }
    lines.push('', '_SS Family_')
    shareToWhatsApp(lines.join('\n'))
  }

  if (loading) return <Spinner label="Loading the shopping list" />

  return (
    <div>
      {/* --------------------------------------------------------- controls */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setGroupBy(tab.key)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              groupBy === tab.key
                ? 'bg-palm-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-sand-200 hover:bg-sand-50'
            }`}
            title={tab.hint}
          >
            <span aria-hidden>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar value={search} onChange={setSearch} placeholder="Find an item, shop or person…" />
        <Button variant="secondary" onClick={() => setHideDone((v) => !v)}>
          {hideDone ? 'Show bought' : 'Hide bought'}
        </Button>
      </div>

      <p className="mb-4 text-sm text-slate-500">
        <strong className="text-slate-700">{pending}</strong> item{pending === 1 ? '' : 's'} still
        to buy.
      </p>

      {/* ------------------------------------------------------------ groups */}
      {visible.length === 0 ? (
        <EmptyState
          icon="✅"
          title={search ? 'Nothing matches' : 'Nothing to buy'}
          description={
            search
              ? 'Try a different word.'
              : 'When the family sends their baskets, the items appear here.'
          }
        />
      ) : groupBy === 'item' ? (
        <Card className="divide-y divide-sand-100">
          {(groups as { rows: DriverItem[]; total: number }[]).map(({ rows: group, total }) => {
            const first = group[0]
            const done = group.every((r) => r.status !== 'pending')
            return (
              <div key={first.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`flex-1 text-sm ${done ? 'text-slate-400 line-through' : 'font-semibold text-slate-800'}`}>
                  {first.item_name}
                </span>
                <Badge tone="gray">
                  {fmtQty(total)} {first.unit}
                </Badge>
                <Badge tone="blue">🏪 {first.store}</Badge>
                {group.length > 1 && (
                  <span className="text-xs text-slate-400">
                    {[...new Set(group.map((r) => r.requested_by))].join(', ')}
                  </span>
                )}
                {canPurchase && (
                  <Button
                    size="sm"
                    variant={done ? 'ghost' : 'success'}
                    onClick={() => void setStatus(group.map((r) => r.id), done ? 'pending' : 'purchased')}
                  >
                    {done ? '↩ Undo' : '✓ Bought'}
                  </Button>
                )}
              </div>
            )
          })}
        </Card>
      ) : (
        <div className="space-y-4">
          {(groups as [string, DriverItem[]][]).map(([label, group]) => {
            const groupPending = group.filter((r) => r.status === 'pending')
            return (
              <Card key={label} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-sand-100 bg-sand-50/60 px-4 py-3">
                  <span className="text-lg" aria-hidden>
                    {groupBy === 'store' ? '🏪' : '👤'}
                  </span>
                  <span className="flex-1 font-bold text-slate-800">{label}</span>
                  <Badge tone={groupPending.length > 0 ? 'yellow' : 'green'}>
                    {groupPending.length > 0 ? `${groupPending.length} to buy` : 'All bought'}
                  </Badge>
                  <button
                    onClick={() => shareGroup(label, group)}
                    className="rounded-lg bg-sand-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                    title="Send this group on WhatsApp"
                  >
                    💬
                  </button>
                  {canPurchase && groupPending.length > 0 && (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => void setStatus(groupPending.map((r) => r.id), 'purchased')}
                    >
                      ✓ All bought
                    </Button>
                  )}
                </div>

                <ul className="divide-y divide-sand-100">
                  {group.map((row) => {
                    const done = row.status !== 'pending'
                    return (
                      <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <span
                          className={`min-w-0 flex-1 text-sm ${
                            done ? 'text-slate-400 line-through' : 'font-semibold text-slate-800'
                          }`}
                        >
                          {row.item_name}
                          {row.notes && (
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              ↳ {row.notes}
                            </span>
                          )}
                        </span>

                        <Badge tone="gray">
                          {fmtQty(row.quantity)} {row.unit}
                        </Badge>

                        {/* The other axis: on a shop card show who, on a person card show where. */}
                        <Badge tone={groupBy === 'store' ? 'blue' : 'purple'}>
                          {groupBy === 'store' ? `👤 ${row.requested_by}` : `🏪 ${row.store}`}
                        </Badge>

                        {row.priority === 'high' && <Badge tone="red">Urgent</Badge>}

                        <span className="text-[11px] text-slate-400">
                          {relativeTime(row.submitted_at)}
                        </span>

                        {canPurchase && (
                          <Button
                            size="sm"
                            variant={done ? 'ghost' : 'success'}
                            onClick={() => void setStatus([row.id], done ? 'pending' : 'purchased')}
                          >
                            {done ? '↩' : '✓'}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
