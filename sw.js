// Service worker: permite abrir la app sin conexión.
const CACHE = 'dilo-v4';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'js/parser.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Red primero (para recibir actualizaciones), caché si no hay conexión
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // no-cache: pregunta siempre a la web si hay versión nueva antes de usar la copia del navegador
    fetch(e.request, { cache: 'no-cache' })
      .then(async (res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }
        // Si la web da error (por ejemplo 404 mientras se publica), usamos la copia guardada
        return (await caches.match(e.request, { ignoreSearch: true })) || res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
