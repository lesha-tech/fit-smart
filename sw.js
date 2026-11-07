/* ==========================================================
   FIT SMART — Service Worker: офлайн-кэш приложения
   Стратегия: «сначала кэш» + тихое обновление в фоне
   (stale-while-revalidate): мгновенный запуск из кэша,
   при следующей перезагрузке пользователь уже на свежей версии.
   ========================================================== */

const CACHE = 'fitsmart-v1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './apple-touch-icon.png',
  // график (Chart.js) тоже кладём в кэш — график рисуется и офлайн
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // allSettled: если один файл не докачался — worker всё равно установится
    await Promise.allSettled(ASSETS.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const isChartCdn = url.origin === 'https://cdn.jsdelivr.net';
  // остальное (API FatSecret, OCR) перехватывать не нужно — онлайн-only
  if (!sameOrigin && !isChartCdn) return;
  // запросы на установку/обновление worker не кэшируем
  if (url.pathname.endsWith('sw.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);

    // есть в кэше — отдаём мгновенно и тихо обновляем в фоне
    if (cached) {
      event.waitUntil((async () => {
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) await cache.put(req, res);
        } catch (e) { /* офлайн — отдали кэш, и хорошо */ }
      })());
      return cached;
    }

    // нет в кэше — идём в сеть и складываем на будущее
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        event.waitUntil(cache.put(req, res.clone()));
      }
      return res;
    } catch (e) {
      // совсем офлайн и нет в кэше: открываем оболочку приложения
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
