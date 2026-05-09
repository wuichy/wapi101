// Self-unregistering Service Worker.
//
// El SW anterior cacheaba app shell (styles.css, /app, etc) network-first y
// causaba problemas de cache stale dificiles de debuggear. Como push web
// todavia no esta en uso, eliminamos PWA completamente.
//
// Este SW se reemplaza encima del v4/v5 viejo. En install + activate hace:
// 1) skipWaiting + claim para tomar control inmediato
// 2) borra TODOS los caches del origen
// 3) se desregistra a si mismo
// 4) recarga las pestañas abiertas para que ya no tengan SW
//
// Una vez que todos los clientes pasaron por aqui una vez, sw.js se vuelve
// inerte. Si en el futuro queremos push, agregamos un sw.js NUEVO con otra
// logica (solo handler 'push', sin caching).

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // Borrar todos los caches
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (_) {}

    // Tomar control de las pestañas abiertas
    try { await self.clients.claim(); } catch (_) {}

    // Desregistrar este SW
    try { await self.registration.unregister(); } catch (_) {}

    // Forzar reload de las pestañas para que ya no tengan SW activo
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try { client.navigate(client.url); } catch (_) {}
      }
    } catch (_) {}
  })());
});

// Fetch handler vacio — pasa todo al network normal.
// (No definir 'fetch' es equivalente, pero lo dejamos explicito)
self.addEventListener('fetch', () => { /* passthrough */ });
