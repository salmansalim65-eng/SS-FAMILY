import { useCallback, useEffect, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { relativeTime } from '../lib/format'
import {
  currentEndpoint,
  disablePush,
  enablePush,
  isStandalone,
  permission,
  pushSupport,
} from '../lib/push'
import { Badge, Button, Card, Spinner } from './ui'

interface DeviceRow {
  id: string
  endpoint: string
  device_label: string | null
  last_used_at: string | null
  created_at: string
}

/**
 * Turns phone notifications on for *this* device.
 *
 * Push subscriptions belong to a browser, not to a person, so this has to be
 * done once on each phone — and the list below exists so it is obvious which
 * ones are already done and which are not.
 */
export function PushPanel() {
  const { profile } = useAuth()
  const toast = useToast()

  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [testing, setTesting] = useState(false)

  const support = pushSupport()
  const perm = permission()

  const load = useCallback(async () => {
    if (!profile) return
    const [{ data }, endpoint] = await Promise.all([
      supabase
        .from('push_subscriptions')
        .select('id, endpoint, device_label, last_used_at, created_at')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false }),
      currentEndpoint(),
    ])
    setDevices((data ?? []) as unknown as DeviceRow[])
    setThisEndpoint(endpoint)
    setLoading(false)
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  const registeredHere = Boolean(
    thisEndpoint && devices.some((d) => d.endpoint === thisEndpoint),
  )

  // ------------------------------------------------------------------ actions
  const turnOn = async () => {
    if (!profile) return
    setWorking(true)
    const result = await enablePush(profile.id)
    setWorking(false)

    if (result.ok) {
      toast.success('Notifications are on for this device.')
      await load()
      return
    }
    if (result.reason === 'denied') {
      toast.error('Permission was refused. Allow notifications in your browser settings, then try again.')
    } else if (result.reason === 'needs-install') {
      toast.error('On iPhone, add the app to your Home Screen first.')
    } else if (result.reason === 'no-key') {
      toast.error('Push is not configured on the server yet.')
    } else {
      toast.error(result.message ?? 'Could not turn on notifications.')
    }
  }

  const turnOff = async () => {
    setWorking(true)
    try {
      await disablePush()
      toast.success('Notifications are off for this device.')
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    }
    setWorking(false)
  }

  const forget = async (device: DeviceRow) => {
    const { error } = await supabase.from('push_subscriptions').delete().eq('id', device.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Device removed.')
    await load()
  }

  const sendTest = async () => {
    setTesting(true)
    const { data, error } = await supabase.functions.invoke('send-push', { body: { test: true } })
    setTesting(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    const result = data as { configured?: boolean; sent?: number } | null
    if (result?.configured === false) {
      toast.error('The server has no VAPID keys yet, so nothing was sent.')
    } else if (result?.sent && result.sent > 0) {
      toast.success('Sent. It should appear on your phone in a moment.')
    } else {
      toast.error('Nothing was delivered — check the device list above.')
    }
  }

  if (loading) return <Spinner label="Checking this device" />

  return (
    <Card className="p-5">
      {/* ------------------------------------------------------- this device */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl" aria-hidden>
          {registeredHere ? '🔔' : '🔕'}
        </span>
        <div className="flex-1">
          <p className="font-bold text-slate-800">
            {registeredHere ? 'This device gets notifications' : 'This device is not set up yet'}
          </p>
          <p className="text-sm text-slate-500">
            Guest arrivals, tasks due, menu approvals and the shopping list — the same
            alerts as the bell, but on your phone even when the app is closed.
          </p>
        </div>
        {registeredHere ? (
          <Button variant="secondary" loading={working} onClick={() => void turnOff()}>
            Turn off here
          </Button>
        ) : (
          <Button
            loading={working}
            disabled={support === 'unsupported' || support === 'no-key'}
            onClick={() => void turnOn()}
          >
            Turn on
          </Button>
        )}
      </div>

      {/* ------------------------------------------------------- what is wrong */}
      {support === 'needs-install' && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">One extra step on iPhone and iPad</p>
          <p className="mt-1">
            Apple only allows notifications once the app is on your Home Screen. In Safari,
            tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open SS
            Family from the new icon and come back here.
          </p>
        </div>
      )}

      {support === 'unsupported' && (
        <div className="mt-4 rounded-2xl border border-sand-200 bg-sand-50 px-4 py-3 text-sm text-slate-600">
          This browser cannot show notifications. Chrome or Edge on Android, or Safari on an
          iPhone with the app added to the Home Screen, all work.
        </div>
      )}

      {support === 'no-key' && (
        <div className="mt-4 rounded-2xl border border-sand-200 bg-sand-50 px-4 py-3 text-sm text-slate-600">
          Push is not configured for this deployment yet.
        </div>
      )}

      {perm === 'denied' && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Notifications are blocked for this site. Open your browser's site settings, allow
          notifications for SS Family, then reload.
        </div>
      )}

      {isStandalone() && (
        <p className="mt-3 text-xs text-slate-400">Running from the Home Screen — good.</p>
      )}

      {/* ------------------------------------------------------------ devices */}
      <div className="mt-5 border-t border-sand-100 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-700">
            Your devices {devices.length > 0 && `(${devices.length})`}
          </h4>
          {devices.length > 0 && (
            <Button variant="ghost" loading={testing} onClick={() => void sendTest()}>
              Send a test
            </Button>
          )}
        </div>

        {devices.length === 0 ? (
          <p className="text-sm text-slate-500">
            No devices yet. Turn notifications on here, and on any other phone you use.
          </p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-2.5">
                <span className="text-lg" aria-hidden>
                  📱
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {device.device_label ?? 'Unknown device'}
                    {device.endpoint === thisEndpoint && (
                      <Badge tone="green" className="ml-2">
                        this one
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {device.last_used_at
                      ? `Last notified ${relativeTime(device.last_used_at)}`
                      : `Added ${relativeTime(device.created_at)}`}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => void forget(device)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
