const CACHE = 'us-v8';
const BASE = '/Tether';
const ASSETS = [`${BASE}/`, `${BASE}/index.html`, `${BASE}/manifest.json`];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── WEB PUSH ──
self.addEventListener('push', e => {
  if(!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title:'Tether', body: e.data.text() }; }

  e.waitUntil((async () => {
    const list = await clients.matchAll({ type:'window', includeUncontrolled:true });
    const anyVisible = list.some(c => c.visibilityState === 'visible');

    // ── RING PUSH ──
    if(data.type === 'ring'){
      // If app is already open and visible — tell it to ring directly
      if(anyVisible){
        list.forEach(c => c.postMessage({ type:'DO_RING', from: data.from }));
        return;
      }
      // App is closed or hidden — open it with ?ring=1 so it auto-rings on load
      const ringUrl = `${BASE}/?ring=1&from=${encodeURIComponent(data.from||'')}`;
      // Show a notification too so user sees something immediately
      await self.registration.showNotification('💌 ' + (data.from||'Tether'), {
        body: 'thinking of you',
        icon:  `${BASE}/icon.png`,
        badge: `${BASE}/icon.png`,
        tag: 'us-ring',
        renotify: true,
        vibrate: [300,100,300,100,300,100,300],
        silent: false,
        requireInteraction: true,   // stays on screen until tapped
        data: { url: ringUrl, type:'ring' }
      });
      // Also open the app immediately
      const openable = list.find(c => 'navigate' in c);
      if(openable){
        openable.navigate(ringUrl);
      } else {
        clients.openWindow(ringUrl);
      }
      return;
    }

    // ── NORMAL MESSAGE PUSH ──
    if(anyVisible) return;
    return self.registration.showNotification(data.title || 'Tether', {
      body: data.body || '…',
      icon:  `${BASE}/icon.png`,
      badge: `${BASE}/icon.png`,
      tag: 'us-message',
      renotify: true,
      vibrate: [200, 100, 200],
      silent: false,
      requireInteraction: false,
      data: { url: data.url || `${BASE}/` }
    });
  })());
});

// ── MESSAGES FROM PAGE ──
self.addEventListener('message', e => {
  if(!e.data) return;

  if(e.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
    return;
  }

  if(e.data.type === 'SHOW_NOTIF'){
    e.waitUntil(
      clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
        const anyVisible = list.some(c => c.visibilityState === 'visible');
        if(anyVisible) return;
        return self.registration.showNotification(e.data.title || 'Tether', {
          body: e.data.body || '…',
          icon:  `${BASE}/icon.png`,
          badge: `${BASE}/icon.png`,
          tag: 'us-message',
          renotify: true,
          vibrate: [200, 100, 200],
          silent: false,
          requireInteraction: false,
          data: { url: `${BASE}/` }
        });
      })
    );
  }

  if(e.data.type === 'CLEAR_NOTIF'){
    self.registration.getNotifications().then(notifs => {
      notifs.forEach(n => n.close());
    });
  }
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || `${BASE}/`;
  e.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      // For ring notifications — focus or open with ring param
      for(const c of list){
        if(c.url.includes(BASE) && 'focus' in c){
          // If it's a ring notif, navigate to ring URL
          if(e.notification.data?.type === 'ring'){
            c.navigate(target);
          }
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
