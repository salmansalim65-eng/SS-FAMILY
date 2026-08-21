import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import {
  countdown,
  daysFromToday,
  dueTone,
  fmtDate,
  menuTone,
  money,
  priorityTone,
  qty,
  titleCase,
} from '../lib/format'
import { Avatar, Badge, Button, Card, EmptyState, SectionHeader, Spinner, StatCard } from '../components/ui'
import type { ConsolidatedItem, DashboardStats, Guest, MenuItem, Task } from '../lib/types'

const MENU_SELECT =
  '*, suggester:users!menu_items_suggested_by_fkey(id, name),' +
  ' cook:users!menu_items_cook_person_fkey(id, name)'

export function DashboardPage() {
  const { profile, isHead } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [tick, reload] = useReload()

  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [shopping, setShopping] = useState<ConsolidatedItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    const in7Days = new Date()
    in7Days.setDate(in7Days.getDate() + 7)
    const today = new Date().toISOString().slice(0, 10)
    const weekEnd = in7Days.toISOString().slice(0, 10)

    Promise.all([
      supabase.rpc('dashboard_stats'),
      supabase
        .from('guests')
        .select('*')
        .gte('arrival_date', today)
        .lte('arrival_date', weekEnd)
        .order('arrival_date'),
      supabase
        .from('menu_items')
        .select(MENU_SELECT)
        .in('status', ['draft', 'approved', 'in_progress'])
        .order('serve_date', { nullsFirst: false })
        .limit(8),
      supabase
        .from('tasks')
        .select('*, assignee:users!tasks_assigned_to_fkey(id, name)')
        .neq('status', 'completed')
        .order('due_date', { nullsFirst: false })
        .limit(8),
      supabase
        .from('shopping_consolidated')
        .select('*')
        .eq('status', 'pending')
        .order('category')
        .limit(8),
    ]).then(([statRes, guestRes, menuRes, taskRes, shopRes]) => {
      if (!active) return
      if (statRes.error) toast.error(errorMessage(statRes.error))
      setStats(statRes.data as DashboardStats | null)
      setGuests((guestRes.data ?? []) as Guest[])
      // The client cannot infer a select string with this many embeds, so the
      // shape is asserted here instead.
      setMenu((menuRes.data ?? []) as unknown as MenuItem[])
      setTasks((taskRes.data ?? []) as Task[])
      setShopping((shopRes.data ?? []) as ConsolidatedItem[])
      setLoading(false)
    })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const approve = async (item: MenuItem) => {
    const { error } = await supabase
      .from('menu_items')
      .update({ status: 'approved', approved_by: profile?.id })
      .eq('id', item.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`"${item.dish_name}" approved — task created.`)
    reload()
  }

  const completeTask = async (task: Task) => {
    const { error } = await supabase.from('tasks').update({ status: 'completed' }).eq('id', task.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`"${task.title}" completed.`)
    reload()
  }

  if (loading) return <Spinner label="Loading your dashboard" />

  const firstName = profile?.name?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-800 sm:text-3xl">
          {greeting}, {firstName}
        </h1>
        <p className="text-sm text-slate-500">
          {fmtDate(new Date().toISOString(), 'EEEE, dd MMMM yyyy')}
          {isHead && ' · You have approval authority'}
        </p>
      </header>

      {/* ------------------------------------------------------- quick stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon="🧳"
          label="Guests next 7 days"
          value={stats?.upcoming_guests ?? 0}
          sub={`${stats?.total_guest_heads ?? 0} people staying`}
          tone="blue"
          onClick={() => navigate('/guests')}
        />
        <StatCard
          icon="🍽️"
          label="Menu items active"
          value={(stats?.menu_draft ?? 0) + (stats?.menu_approved ?? 0)}
          sub={`${stats?.menu_draft ?? 0} awaiting approval`}
          tone={stats?.menu_draft ? 'yellow' : 'gray'}
          onClick={() => navigate('/menu')}
        />
        <StatCard
          icon="✅"
          label="Tasks pending"
          value={stats?.tasks_pending ?? 0}
          sub={
            stats?.tasks_overdue
              ? `${stats.tasks_overdue} overdue`
              : `${stats?.tasks_due_soon ?? 0} due soon`
          }
          tone={stats?.tasks_overdue ? 'red' : 'green'}
          onClick={() => navigate('/tasks')}
        />
        <StatCard
          icon="🛒"
          label="Items to buy"
          value={stats?.shopping_pending ?? 0}
          sub={`Meals budgeted ${money(stats?.menu_cost ?? 0)}`}
          tone="purple"
          onClick={() => navigate('/shopping')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------ upcoming guests */}
        <section>
          <SectionHeader
            icon="🧳"
            title="Upcoming guests"
            count={guests.length}
            action={
              <Link to="/guests" className="text-sm font-semibold text-palm-700 hover:underline">
                View all
              </Link>
            }
          />
          {guests.length === 0 ? (
            <EmptyState icon="🧳" title="No arrivals in the next 7 days" />
          ) : (
            <div className="space-y-3">
              {guests.map((guest) => {
                const days = daysFromToday(guest.arrival_date) ?? 0
                const urgent = days <= 3
                return (
                  <Card
                    key={guest.id}
                    accent={urgent ? 'bg-red-500' : 'bg-sky-500'}
                    className="flex items-center gap-3 p-4 pl-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-800">{guest.name}</p>
                      <p className="text-xs text-slate-500">
                        {guest.total_guests} guests ({guest.male_count}M / {guest.female_count}F)
                        {guest.room ? ` · ${guest.room}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{fmtDate(guest.arrival_date)}</p>
                    </div>
                    <Badge tone={urgent ? 'red' : 'blue'}>
                      {days === 0 ? 'Arriving today' : countdown(guest.arrival_date)}
                    </Badge>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------ menu items */}
        <section>
          <SectionHeader
            icon="🍽️"
            title="Active menu"
            count={menu.length}
            action={
              <Link to="/menu" className="text-sm font-semibold text-palm-700 hover:underline">
                View all
              </Link>
            }
          />
          {menu.length === 0 ? (
            <EmptyState icon="🍽️" title="Nothing on the menu yet" />
          ) : (
            <div className="space-y-3">
              {menu.map((item) => (
                <Card key={item.id} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-800">{item.dish_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {titleCase(item.meal_type)}
                      {item.serve_date ? ` · ${fmtDate(item.serve_date, 'dd MMM')}` : ''} ·{' '}
                      {qty(item.quantity)} {item.unit} · {money(item.cost)}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      by {item.suggester?.name ?? 'Unknown'}
                      {item.cook?.name ? ` · cook: ${item.cook.name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1.5">
                    <Badge tone={menuTone(item.status)}>{titleCase(item.status)}</Badge>
                    {isHead && item.status === 'draft' && (
                      <Button size="sm" variant="success" onClick={() => void approve(item)}>
                        ✓ Approve
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- tasks due soon */}
        <section>
          <SectionHeader
            icon="✅"
            title="Tasks due soon"
            count={tasks.length}
            action={
              <Link to="/tasks" className="text-sm font-semibold text-palm-700 hover:underline">
                View all
              </Link>
            }
          />
          {tasks.length === 0 ? (
            <EmptyState icon="🎉" title="No open tasks" description="Everything is done." />
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => {
                const tone = dueTone(task.due_date, task.status)
                const mine = task.assigned_to === profile?.id
                return (
                  <Card
                    key={task.id}
                    accent={
                      tone === 'red' ? 'bg-red-500' : tone === 'yellow' ? 'bg-amber-400' : 'bg-slate-300'
                    }
                    className="flex items-center gap-3 p-4 pl-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-slate-800">{task.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={priorityTone(task.priority)}>{titleCase(task.priority)}</Badge>
                        {task.due_date && (
                          <span
                            className={`font-semibold ${
                              tone === 'red'
                                ? 'text-red-600'
                                : tone === 'yellow'
                                  ? 'text-amber-600'
                                  : 'text-slate-500'
                            }`}
                          >
                            {countdown(task.due_date)}
                          </span>
                        )}
                        {task.assignee?.name && (
                          <span className="flex items-center gap-1 text-slate-500">
                            <Avatar name={task.assignee.name} size="sm" />
                            {mine ? 'You' : task.assignee.name}
                          </span>
                        )}
                      </div>
                    </div>
                    {(mine || isHead) && (
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => void completeTask(task)}
                        className="flex-none"
                      >
                        ✓
                      </Button>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------- shopping */}
        <section>
          <SectionHeader
            icon="🛒"
            title="Shopping list"
            count={shopping.length}
            action={
              <Link to="/shopping" className="text-sm font-semibold text-palm-700 hover:underline">
                View all
              </Link>
            }
          />
          {shopping.length === 0 ? (
            <EmptyState icon="🛒" title="Nothing to buy" />
          ) : (
            <Card className="divide-y divide-sand-100">
              {shopping.map((row) => (
                <div
                  key={`${row.normalized_name}-${row.unit}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800">
                      {row.item_name}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {row.category}
                      {row.entry_count > 1 && (
                        <span className="text-palm-700"> · merged from {row.entry_count}</span>
                      )}
                    </span>
                  </span>
                  {row.priority === 'high' && <Badge tone="red">Urgent</Badge>}
                  <span className="flex-none rounded-lg bg-sand-100 px-2.5 py-1 text-sm font-bold text-slate-700">
                    {qty(row.total_quantity)} {row.unit}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}
