// Service worker: permite abrir la app sin conexión.
const CACHE = 'dilo-v17';
const ASSETS = [
  './',
  'index.html',
  'agenda.html',
  'styles.css',
  'js/parser.js',
  'js/app.js',
  'js/nube.js',
  'js/vendor/firebase/firebase-app.js',
  'js/vendor/firebase/firebase-auth.js',
  'js/vendor/firebase/firebase-firestore.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/badge-96.png',
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
  // Solo los archivos de la propia app (y sus fuentes). Las conexiones con Google/Firebase van directas.
  const url = new URL(e.request.url);
  const propio = url.origin === self.location.origin;
  const fuentes = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!propio && !fuentes) return;
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

// Al tocar la notificación de "Apuntado": abrir la app en esa lista para revisarlo
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  // Notificaciones de la agenda abren la cita; las de las listas abren la lista
  const page = d.agenda ? 'agenda.html' + (d.citaId ? '?cita=' + encodeURIComponent(d.citaId) : '')
    : './' + (d.listId ? '?lista=' + encodeURIComponent(d.listId) : '');
  const url = new URL(page, self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        const enAgenda = w.url.includes('agenda.html');
        if (w.url.startsWith(self.registration.scope) && enAgenda === !!d.agenda) {
          w.postMessage(d.agenda ? { openCita: d.citaId } : { openList: d.listId });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
