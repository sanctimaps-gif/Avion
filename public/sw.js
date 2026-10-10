// Service worker : met en cache le jeu pour un fonctionnement 100 % hors ligne
// lorsqu'il est servi en HTTPS (PWA). Le jeu est un fichier unique autonome.
const CACHE = 'airport-manager-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Cache d'abord (hors ligne), mise à jour en arrière-plan.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request)
        .then((r) => {
          if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => hit || caches.match('./index.html'));
      return hit || net;
    }),
  );
});
