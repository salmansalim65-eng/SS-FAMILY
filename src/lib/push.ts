import { supabase } from './supabase'

/**
 * Web push, from the browser's side.
 *
 * The public VAPID key is exactly that — public. It is baked into the bundle
 * so the browser can prove to the push service which application server is
 * allowed to send to this subscription. The private half lives only in the
 * edge function's secrets.
 */
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export type PushSupport =
  | 'ready'
  | 'unsupported'
  | 'needs-install'   // iOS: only works once added to the Home Screen
  | 'no-key'          // the build has no VAPID key

/**
 * iOS only exposes the Push API to a web app that has been added to the Home
 * Screen, and gives no way to trigger that from script — the user has to use
 * the Share menu. Detecting it up front is the difference between a helpful
 * instruction and a button that silently does nothing.
 */
function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return 'no-key'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (isIos() && !isStandalone()) return 'needs-install'
  return 'ready'
}

export function permission(): NotificationPermission | 'unavailable' {
  return typeof Notification === 'undefined' ? 'unavailable' : Notification.permission
}

/**
 * base64url → bytes, the form applicationServerKey wants. Backed by a plain
 * ArrayBuffer so it satisfies BufferSource rather than a generic Uint8Array.
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return buffer
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A short human label so Settings can say *which* phone is registered. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Device'
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  return `${os} · ${browser}`
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (error) {
    console.warn('Service worker registration failed:', error)
    return null
  }
}

export interface EnableResult {
  ok: boolean
  reason?: 'denied' | 'unsupported' | 'needs-install' | 'no-key' | 'error'
  message?: string
}

/**
 * Ask for permission, subscribe, and store the subscription against the signed
 * in user. Safe to call again — the endpoint is unique, so re-running it just
 * refreshes the existing row rather than creating a duplicate.
 */
export async function enablePush(userId: string): Promise<EnableResult> {
  const support = pushSupport()
  if (support !== 'ready') return { ok: false, reason: support }

  const granted = await Notification.requestPermission()
  if (granted !== 'granted') return { ok: false, reason: 'denied' }

  try {
    const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)

    // An existing subscription made with a different key would be silently
    // undeliverable, so replace it rather than trusting it.
    const existing = await registration.pushManager.getSubscription()
    if (existing) await existing.unsubscribe()

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
    })

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: encodeKey(subscription.getKey('p256dh')),
        auth: encodeKey(subscription.getKey('auth')),
        device_label: deviceLabel(),
        failures: 0,
      },
      { onConflict: 'endpoint' },
    )

    if (error) return { ok: false, reason: 'error', message: error.message }
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Turn pushes off on this device, and forget it server-side. */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

/** Is *this* browser already subscribed? */
export async function currentEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    return subscription?.endpoint ?? null
  } catch {
    return null
  }
}
