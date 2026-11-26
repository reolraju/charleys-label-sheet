/* Charley's Label Sheet — offline cache + Android Share-menu target. Bump VERSION when files change. */
const VERSION = 'charleys-v2';
const SHELL = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './vendor/pdf-lib.min.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'charleys-shared').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // A PDF shared from another app arrives here as a POST (see manifest share_target).
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('pdf');
        if (file && typeof file !== 'string') {
          const cache = await caches.open('charleys-shared');
          await cache.put('shared.pdf', new Response(file, {
            headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent(file.name || 'Amazon label.pdf') }
          }));
        }
      } catch (_) { /* page shows a message if nothing arrived */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Cached first (works offline), refreshed in the background.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await fresh) || new Response('Offline', { status: 503 });
  })());
});
