// RentSlate Meter service worker: makes the app installable and keeps the app
// shell available offline. It never caches Supabase/API or cross-origin
// requests — bills, readings and logins always come from the network.
const CACHE = 'rentslate-meter-v2';
const NAV_TIMEOUT_MS = 6000;
const SHELL = ['./', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Pages: network first so a new deploy shows immediately; if the network is
  // down or too slow, fall back to the cached app shell instead of hanging.
  if (req.mode === 'navigate') {
    const network = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); }
      return res;
    });
    const slow = new Promise(resolve => setTimeout(resolve, NAV_TIMEOUT_MS)).then(() => caches.match('./'));
    event.respondWith(
      Promise.race([network, slow])
        .then(res => res || network)
        .catch(() => caches.match('./').then(hit => hit || network))
    );
    return;
  }

  // Build assets have content hashes in their names, so cache-first is safe.
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
