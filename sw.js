/* ═══════════════════════════════════════════════════════
   Satyam's Store — Admin Service Worker
   Purpose: PWA installability + push notifications only.
   This is a data-driven admin dashboard (always needs a live
   Supabase connection), so it intentionally does NOT try to
   cache pages for offline use — that would add complexity
   without giving you anything real, since a stale product
   list or order queue while offline is actively misleading.
   ═══════════════════════════════════════════════════════ */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pure network passthrough — no caching layer to keep stale.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
});

// ── Push notification received ──────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'New order', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'New order!';
  const options = {
    body: data.body || 'Tap to view the order',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [120, 60, 120],
    data: { orderId: data.orderId || null },
    // tag + renotify: if two orders come in back-to-back, the second
    // still alerts (renotify), but they don't pile up as separate
    // notifications for the same order if a push is retried.
    tag: data.orderId ? ('order-' + data.orderId) : undefined,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification tapped — deep-link straight to that order ─
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const orderId = event.notification.data && event.notification.data.orderId;
  const targetUrl = orderId
    ? `admin.html?order=${encodeURIComponent(orderId)}`
    : 'admin.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('admin.html') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
