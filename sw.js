/* ═══════════════════════════════════════════════════════
   Satyam's Store — Service Worker
   Shared by both the storefront (index.html) and admin panel
   (admin.html) — handles PWA installability and push notifications
   for two separate audiences: order alerts (admin only) and store
   broadcasts (any customer who opted in via the storefront bell).
   This is a data-driven site (always needs a live Supabase
   connection), so it intentionally does NOT try to cache pages for
   offline use — that would add complexity without giving you
   anything real, since stale product/order data while offline is
   actively misleading.
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

  const isBroadcast = data.type === 'broadcast';
  const title = data.title || (isBroadcast ? "Store update" : 'New order!');
  const options = {
    body: data.body || 'Tap to view',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [120, 60, 120],
    data: { type: data.type || 'order', orderId: data.orderId || null },
    // tag + renotify: if two pushes come in back-to-back, the second
    // still alerts (renotify), but same-order pushes don't pile up as
    // separate notifications if one gets retried.
    tag: data.orderId ? ('order-' + data.orderId) : undefined,
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification tapped ───────────────────────────────────
// Order alerts deep-link straight into that order in admin.html.
// Broadcasts (store open/closed, etc.) just bring the storefront to
// the front — there's no specific order to jump to.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const info = event.notification.data || {};
  const targetUrl = info.type === 'broadcast'
    ? 'index.html'
    : (info.orderId ? `admin.html?order=${encodeURIComponent(info.orderId)}` : 'admin.html');
  const matchFragment = info.type === 'broadcast' ? 'index.html' : 'admin.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(matchFragment) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
