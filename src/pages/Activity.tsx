import { useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { fmtDate, fmtDateTime, relativeTime, titleCase } from '../lib/format'
import { Avatar, Badge, Card, EmptyState, SearchBar, Select, Spinner } from '../components/ui'
import type { ActivityEntry } from '../lib/types'

const ENTITY_ICON: Record<string, string> = {
  guest: '🧳',
  menu_item: '🍽️',
  task: '✅',
  shopping_item: '🛒',
}

const VERB: Record<string, string> = {
  insert: 'added',
  update: 'updated',
  delete: 'removed',
}

function describe(entry: ActivityEntry): string {
  const [op] = entry.action.split('_')
  const verb = VERB[op] ?? op
  const what = entry.entity_type.replace(/_/g, ' ')

  if (op === 'update' && entry.details?.to) {
    const from = entry.details.from ? `${entry.details.from} → ` : ''
    return `moved ${what} to ${from}${entry.details.to}`.replace(`${entry.details.to} → `, '')
  }
  return `${verb} ${what}`
}

export function ActivityPage() {
  const toast = useToast()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [entity, setEntity] = useState('all')

  useEffect(() => {
    let active = true
    supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(250)
      .then(({ data, error }) => {
        if (!active) return
        if (error) toast.error(errorMessage(error))
        setEntries((data ?? []) as ActivityEntry[])
        setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (entity !== 'all' && entry.entity_type !== entity) return false
      if (!term) return true
      return [entry.actor_name, entry.entity_label, entry.action]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    })
  }, [entries, search, entity])

  /** Group by calendar day so the log reads like a diary. */
  const days = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>()
    visible.forEach((entry) => {
      const key = entry.created_at.slice(0, 10)
      const list = map.get(key) ?? []
      list.push(entry)
      map.set(key, list)
    })
    return [...map.entries()]
  }, [visible])

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-extrabold text-slate-800">Activity log</h1>
        <p className="text-sm text-slate-500">Who did what, and when.</p>
      </header>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchBar value={search} onChange={setSearch} placeholder="Search people or items…" />
        <Select
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          className="sm:w-52"
        >
          <option value="all">Everything</option>
          <option value="guest">Guests</option>
          <option value="menu_item">Menu items</option>
          <option value="task">Tasks</option>
          <option value="shopping_item">Shopping</option>
        </Select>
      </div>

      {loading ? (
        <Spinner label="Loading activity" />
      ) : days.length === 0 ? (
        <EmptyState icon="📜" title="Nothing logged yet" />
      ) : (
        <div className="space-y-6">
          {days.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                {fmtDate(day, 'EEEE, dd MMMM yyyy')}
              </h2>
              <Card className="divide-y divide-sand-100">
                {list.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-sand-100 text-lg">
                      {ENTITY_ICON[entry.entity_type] ?? '•'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-slate-700">
                        <span className="font-bold text-slate-800">
                          {entry.actor_name || 'System'}
                        </span>{' '}
                        {describe(entry)}{' '}
                        {entry.entity_label && (
                          <span className="font-semibold text-slate-800">
                            “{entry.entity_label}”
                          </span>
                        )}
                      </p>
                      <p
                        className="mt-0.5 text-[11px] text-slate-400"
                        title={fmtDateTime(entry.created_at)}
                      >
                        {relativeTime(entry.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      {entry.details?.to && (
                        <Badge tone="gray">{titleCase(String(entry.details.to))}</Badge>
                      )}
                      {entry.actor_name && <Avatar name={entry.actor_name} size="sm" />}
                    </div>
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
