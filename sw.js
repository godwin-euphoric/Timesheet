const CACHE = 'timesheet-v13';
const ASSETS = ['/Timesheet/', '/Timesheet/index.html', '/Timesheet/style.css', '/Timesheet/app.js', '/Timesheet/manifest.json', '/Timesheet/icon.svg', '/Timesheet/icon-192.png', '/Timesheet/icon-512.png', '/Timesheet/icon-maskable-512.png', '/Timesheet/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // allSettled: one missing file must not fail the install (cache.addAll is all-or-nothing)
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(ASSETS.map(url => c.add(url))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim()));
});

// Network first, cached copy when offline. Firebase/Google requests are left to the browser.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).catch(async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    if (e.request.mode === 'navigate') return caches.match('/Timesheet/index.html');
    return Response.error();
  }));
});
