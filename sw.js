const CACHE_NAME = 'workbench-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/assets/bg-wallpaper.jpg', '/assets/labubu-avatar.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request).then(r => r || caches.match('/index.html'));
    })
  );
});
