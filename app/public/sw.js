// Service Worker para Wapi101 CRM
// Versionar el cache nombre fuerza re-install al cambiar (bump cuando se
// modifique el SW para nuevos features).
const CACHE_NAME = 'wapi101-crm-v3';

// App shell mínima para que la PWA funcione offline (al menos cargue el chrome).
// Las API calls y assets dinámicos NO se cachean — siguen network-first.
const SHELL_FILES = [
  '/app',
  '/login',
  '/styles.css',
  '/manifest.json',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // No fallar si alguno no está disponible
    await Promise.all(SHELL_FILES.map(url => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
  })());
});

// Fetch handler: network-first para todo. Si la red falla y es navegación
// (page request), intentamos servir /app desde cache para que la PWA al
// menos abra. Para API calls y otros recursos, dejamos pasar el error de red.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Solo manejamos GETs same-origin. POST/PATCH/DELETE pasan directo.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // No cachear API ni webhooks ni stripe ni admin (dinámicos)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/') ||
      url.pathname.startsWith('/auth/') || url.pathname.startsWith('/super')) {
    return; // pasa al network normal
  }

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // Si es app shell file, actualizar cache en background
      if (SHELL_FILES.includes(url.pathname) || url.pathname === '/app/' || url.pathname === '/login/') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (_) {
      // Network falló — buscar en cache
      const cached = await caches.match(req);
      if (cached) return cached;
      // Si es navegación (HTML), fallback a /app del cache
      if (req.mode === 'navigate') {
        const fallback = await caches.match('/app');
        if (fallback) return fallback;
      }
      throw _;
    }
  })());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'Wapi101 CRM', body: event.data ? event.data.text() : 'Notificación' };
  }
  const title = payload.title || 'Wapi101 CRM';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'wapi101-crm',
    renotify: true,
    data: { url: payload.url || '/', chatId: payload.chatId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/app';
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
