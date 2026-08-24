import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { relativeTime } from '../lib/format'
import { useAuth } from '../context/AuthContext'
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
  system: '⚙️',
}

/** Makes every realtime channel topic unique for the lifetime of the tab. */
let channelSeq = 0

/** A short two-tone chime, synthesised so there is no asset to ship. */
function playChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45)

    ;[880, 1174.7].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(ctx.currentTime + i * 0.12)
      osc.stop(ctx.currentTime + 0.5)
    })

    window.setTimeout(() => void ctx.close(), 900)
  } catch {
    /* audio is a nicety, never a failure */
  }
}

export function NotificationBell() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const knownIds = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  const unread = items.filter((n) => !n.read_at).length

  // Depend on the user's id, not the profile object: AuthContext loads the
  // profile twice (once from getSession, once from onAuthStateChange), so the
  // object identity changes even though the user has not.
  const userId = profile?.id

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)

    const rows = (data ?? []) as AppNotification[]

    // Chime only for genuinely new arrivals, never on the first load.
    if (primed.current) {
      const fresh = rows.some((n) => !knownIds.current.has(n.id) && !n.read_at)
      if (fresh) playChime()
    }
    knownIds.current = new Set(rows.map((n) => n.id))
    primed.current = true
    setItems(rows)
  }, [userId])

  useEffect(() => {
    void load()
    if (!userId) return

    // A fresh topic each time. Re-using a topic can hand back a channel that
    // is already subscribed, and calling .on() on one of those throws — which,
    // from inside an effect, tears down the whole React root.
    channelSeq += 1
    const topic = `notifications-${userId}-${channelSeq}`

    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase.channel(topic)
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      channel.subscribe()
    } catch (error) {
      // Realtime is a convenience, never a hard dependency.
      console.warn('Realtime notifications unavailable:', error)
      channel = null
    }

    // Realtime can be disabled or blocked by a proxy; poll as a safety net.
    const timer = window.setInterval(() => void load(), 60_000)

    return () => {
      if (channel) void supabase.removeChannel(channel)
      window.clearInterval(timer)
    }
  }, [userId, load])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markAllRead = async () => {
    await supabase.rpc('mark_all_notifications_read')
    await load()
  }

  const openItem = async (item: AppNotification) => {
    if (!item.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id)
    }
    setOpen(false)
    await load()
    if (item.link) navigate(item.link)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl p-2.5 text-xl transition hover:bg-sand-100"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        🔔
        {unread > 0 && (
          <>
            <span className="absolute right-1 top-1 h-4 w-4 animate-ping-badge rounded-full bg-red-500" />
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sand-200 px-4 py-3">
            <p className="font-bold text-slate-800">Notifications</p>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-semibold text-palm-700 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing yet.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void openItem(item)}
                  className={`flex w-full gap-3 border-b border-sand-100 px-4 py-3 text-left transition hover:bg-sand-50 ${
                    item.read_at ? '' : 'bg-palm-50/60'
                  }`}
                >
                  <span className="mt-0.5 text-lg" aria-hidden>
                    {ICONS[item.type] ?? '🔔'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {item.title}
                      </span>
                      <span className="flex-none text-[10px] text-slate-400">
                        {relativeTime(item.created_at)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-600">
                      {item.message}
                    </span>
                    {item.push_status === 'sent' && (
                      <span className="mt-1 inline-block text-[10px] font-semibold text-emerald-600">
                        ✓ also sent to your phone
                      </span>
                    )}
                  </span>
                  {!item.read_at && (
                    <span className="mt-2 h-2 w-2 flex-none rounded-full bg-palm-500" />
                  )}
                </button>
              ))
            )}
          </div>

          <button
            onClick={() => {
              setOpen(false)
              navigate('/notifications')
            }}
            className="w-full border-t border-sand-200 py-3 text-center text-sm font-semibold text-palm-700 transition hover:bg-sand-50"
          >
            See all notifications
          </button>
        </div>
      )}
    </div>
  )
}
