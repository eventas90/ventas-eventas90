/* ═══════════════════════════════════════════════════
   Service Worker — Ventas Focus (ventas-eventas90)
   Estrategia: network-first para HTML, network+cache para recursos
   Actualiza automáticamente al detectar nueva versión
═══════════════════════════════════════════════════ */

const CACHE_NAME = 'ventas-eventas90-v1';

// Tomar control inmediatamente al instalar nueva versión
self.addEventListener('install', () => self.skipWaiting());

// Al activar: limpiar cachés viejos y tomar control de todas las pestañas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: HTML siempre de la red, el resto network+cache fallback
self.addEventListener('fetch', event => {
  // Solo interceptar requests del mismo origen
  if (!event.request.url.startsWith(self.location.origin)) return;

  if (event.request.mode === 'navigate') {
    // HTML: siempre red (no-cache), caché solo como fallback offline
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Recursos (JS, CSS, imágenes): red primero, caché como fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
