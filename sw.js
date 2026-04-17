// sw.js — офлайн-кэширование для рецептов
// Стратегия:
//   - Статика (html, css, fonts): cache-first с фоновым обновлением
//   - /api/recipes: network-first, fallback на кэш (офлайн = последний список)
//   - /api/page?id=...: stale-while-revalidate (открывается мгновенно из кэша, обновляется в фоне)

const CACHE_STATIC = 'static-v2';
const CACHE_RUNTIME = 'runtime-v2';
const STATIC_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then(c => c.addAll(STATIC_URLS).catch(()=>null))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![CACHE_STATIC, CACHE_RUNTIME].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не трогаем сторонние домены (шрифты Google)
  if (url.origin !== location.origin) return;

  // API: /api/recipes — network-first
  if (url.pathname === '/api/recipes') {
    e.respondWith(networkFirst(req, CACHE_RUNTIME));
    return;
  }

  // API: /api/page?id=... — stale-while-revalidate
  if (url.pathname === '/api/page') {
    e.respondWith(staleWhileRevalidate(req, CACHE_RUNTIME));
    return;
  }

  // HTML навигация — network-first (чтобы свежие версии доставались)
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(networkFirst(req, CACHE_STATIC));
    return;
  }

  // Всё остальное — cache-first
  e.respondWith(cacheFirst(req, CACHE_STATIC));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('offline', { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Для навигации — отдаём /index.html как shell
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html') || await cache.match('/');
      if (shell) return shell;
    }
    return new Response('offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || fetchPromise || new Response('offline', { status: 503 });
}
