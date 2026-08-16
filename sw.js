const CACHE = 'workbench-v14';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/assets/bg-wallpaper.jpg', '/assets/labubu-avatar.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // 不拦截 WebDAV 的 PUT/OPTIONS
  const url = new URL(req.url);
  // API 代理（含 WebDAV）永远走网络，不缓存，保证同步状态真实
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req));
    return;
  }
  // 页面导航：网络优先，成功则更新缓存，失败回退缓存（离线可用）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }
  // 静态资源：缓存优先，同时后台拉取更新
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
