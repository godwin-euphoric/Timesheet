const CACHE = 'timesheet-v9';
const ASSETS = ['/', '/Timesheet/', '/Timesheet/index.html', '/Timesheet/style.css', '/Timesheet/app.js', '/Timesheet/icon.svg', '/Timesheet/icon-192.png', '/Timesheet/icon-512.png', '/Timesheet/icon-maskable-512.png', '/Timesheet/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim()));
});

self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
