const CACHE_NAME = 'minddump-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for API calls
  if (e.request.url.includes('anthropic.com') || e.request.url.includes('fonts.googleapis')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Push notification support
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'MindDump', {
      body: data.body || 'You have a reminder!',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: [
        { action: 'done', title: '✓ Done' },
        { action: 'snooze', title: '⏱ +30min' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'done') {
    // Post message to client
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'MARK_DONE', id: e.notification.data?.id }))
    );
  } else {
    e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
  }
});
