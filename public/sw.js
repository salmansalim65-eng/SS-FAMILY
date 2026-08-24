/* SS Family — service worker.
 *
 * Deliberately no offline caching. The app is always online in practice and a
 * stale cached bundle is a far worse bug than a slow load. This worker exists
 * for one job: receive pushes and open the right page when one is tapped.
 */
const ICON = '/icon-192.png'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'SS Family', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'SS Family'
  const options = {
    body: payload.body || '',
    icon: ICON,
    badge: ICON,
    // Same tag for the same notification means a re-send replaces the old one
    // instead of stacking a duplicate on the lock screen.
    tag: payload.id || payload.type || 'ss-family',
    data: { link: payload.link || '/' },
    // A guest arriving or a task due is worth a buzz.
    vibrate: [80, 40, 80],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  const target = new URL(link, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Re-use a tab that already has the app open rather than piling up new ones.
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
