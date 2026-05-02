// Service Worker para Reelance Hub PWA
const CACHE_NAME = 'reelance-hub-v3';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Al activarse, tomamos control y eliminamos cualquier SW viejo
  event.waitUntil((async () => {
    await self.clients.claim();
    // Limpiar caches viejos si los hubiera
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
  })());
});

// Push event: muestra notificación nativa del sistema
self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: 'Reelance Hub', body: event.data ? event.data.text() : 'Nuevo mensaje' };
  }

  const title = payload.title || 'Reelance Hub';
  const options = {
    body: payload.body || 'Nuevo mensaje',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'reelance-msg',
    renotify: true,
    data: {
      url: payload.url || '/',
      chatId: payload.chatId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click en notificación: abrir o enfocar la app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin) {
        client.focus();
        if ('navigate' in client) {
          client.navigate(targetUrl).catch(() => {});
        }
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
