const CACHE = 'ges-shell-v8';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './reservoirs-data.js',
  './rivers-data.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API-запросы — всегда через сеть
  if (url.hostname.includes('open-meteo.com') ||
      url.hostname.includes('overpass') ||
      url.hostname.includes('arcgisonline') ||
      url.hostname.includes('tile.openstreetmap') ||
      url.hostname.includes('opentopomap')) {
    return;
  }

  // Остальное — из кэша, с фоновым обновлением
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic'){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});