import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, errorMessage } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import { fmtDateTime, relativeTime } from '../lib/format'
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui'
import type { AppNotification, NotificationType } from '../lib/types'

const ICONS: Record<NotificationType, string> = {
  guest_added: '🧳',
  guest_arriving: '✈️',
  menu_suggested: '💡',
  menu_approved: '✅',
  menu_changed: '✏️',
  task_assigned: '📋',
  task_due: '⏰',
  task_completed: '🎉',
  shopping_updated: '🛒',
  shopping_purchased: '🧾',
}

export function NotificationsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [tick, reload] = useReload()

  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [onlyUnread, setOnlyUnread] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!active) return
        if (error) toast.error(errorMessage(error))
        setItems((data ?? []) as AppNotification[])
        setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const visible = useMemo(
    () => (onlyUnread ? items.filter((n) => !n.read_at) : items),
    [items, onlyUnread],
  )
  const unread = items.filter((n) => !n.read_at).length

  const markAllRead = async () => {
    const { error } = await supabase.rpc('mark_all_notifications_read')
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('All caught up.')
    reload()
  }

  const open = async (item: AppNotification) => {
    if (!item.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id)
      reload()
    }
    if (item.link) navigate(item.link)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Notifications</h1>
          <p className="text-sm text-slate-500">
            {unread > 0 ? `${unread} unread` : 'Everything read'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOnlyUnread((v) => !v)}>
            {onlyUnread ? 'Show all' : 'Unread only'}
          </Button>
          {unread > 0 && <Button onClick={() => void markAllRead()}>Mark all read</Button>}
        </div>
      </header>

      {loading ? (
        <Spinner label="Loading notifications" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={onlyUnread ? 'Nothing unread' : 'No notifications yet'}
          description="You will hear about new guests, menu approvals, task assignments and the shopping list here."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <Card
              key={item.id}
              accent={item.read_at ? undefined : 'bg-palm-500'}
              className={`w-full p-4 ${item.read_at ? '' : 'pl-5'}`}
            >
              <button onClick={() => void open(item)} className="flex w-full gap-3 text-left">
                <span className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sand-100 text-xl">
                  {ICONS[item.type] ?? '🔔'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold text-slate-800">{item.title}</span>
                    <span
                      className="flex-none text-[11px] text-slate-400"
                      title={fmtDateTime(item.created_at)}
                    >
                      {relativeTime(item.created_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-slate-600">
                    {item.message}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="gray">{item.type.replace(/_/g, ' ')}</Badge>
                    {item.whatsapp_status === 'sent' && <Badge tone="green">✓ WhatsApp sent</Badge>}
                    {item.whatsapp_status === 'queued' && <Badge tone="yellow">WhatsApp queued</Badge>}
                    {item.whatsapp_status === 'failed' && (
                      <Badge tone="red" className="max-w-full truncate">
                        WhatsApp failed
                      </Badge>
                    )}
                    {item.whatsapp_status === 'disabled' && (
                      <Badge tone="gray">WhatsApp not configured</Badge>
                    )}
                  </span>
                </span>
                {!item.read_at && (
                  <span className="mt-2 h-2.5 w-2.5 flex-none rounded-full bg-palm-500" />
                )}
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
