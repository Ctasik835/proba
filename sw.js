const CACHE = 'ges-shell-v16';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './reservoirs-data.js',
  './rivers-data.js',
  './terrain-data.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))   // один сбойный файл не валит установку
      .then(() => self.skipWaiting())
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
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Внешние API и тайлы — всегда сеть
  if (url.hostname.includes('open-meteo.com') ||
      url.hostname.includes('overpass') ||
      url.hostname.includes('arcgisonline') ||
      url.hostname.includes('tile.openstreetmap') ||
      url.hostname.includes('opentopomap')) {
    return;
  }

  // NETWORK-FIRST: всегда свежая версия файлов, кэш — только офлайн-фолбэк.
  // (Раньше была стратегия cache-first — из-за неё после замены файлов
  //  сайт продолжал показывать старую версию.)
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200){
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
