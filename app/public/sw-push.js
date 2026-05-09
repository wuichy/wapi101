// Service Worker mínimo — SOLO push notifications.
//
// IMPORTANTE: este SW deliberadamente NO cachea ningún asset (HTML/CSS/JS).
// El SW anterior (sw.js v4/v5) cacheaba app shell network-first y causó
// horas de debug por cache stale. Aprendizaje: la PWA solo necesita un SW
// para recibir push events; offline shell no se usa en este producto porque
// la app no funciona sin red de todos modos (depende de la API).
//
// Si en el futuro se quiere offline shell, hacerlo en un archivo DISTINTO
// y bumpear cache-version cada deploy. NO mezclar push + caching aquí.

self.addEventListener('install', (event) => {
  // Activar inmediatamente sin esperar al refresh de la pestaña
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// NO definimos 'fetch' handler — los requests pasan directo al network.
// Esto es intencional: cualquier asset cacheado aquí se vuelve un dolor de
// cabeza al deploy.

// Push notification recibida del servidor (web-push lib en backend)
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {
      title: 'Wapi101',
      body: event.data ? event.data.text() : 'Notificación',
    };
  }
  const title = payload.title || 'Wapi101';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'wapi101',
    renotify: true,
    data: { url: payload.url || '/chat', chatId: payload.chatId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click en la notificación → abre/enfoca la pestaña al URL del payload
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/chat';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin) {
        client.focus();
        if ('navigate' in client) client.navigate(targetUrl).catch(() => {});
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
