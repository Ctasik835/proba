/* Service worker оболочки. Имя кэша = 'ges-shell-' + APP_VERSION из
   version.js: поднимаете версию там — старый кэш сбрасывается сам. */
importScripts('./version.js');
const CACHE = 'ges-shell-' + (self.APP_VERSION || 'dev');

const SHELL = [
  './',
  './index.html',
  './style.css',
  './version.js',
  './model.js',
  './app.js',
  './reservoirs-data.js',
  './rivers-data.js',
  './terrain-data.js',
  './climate-data.js',
  './manifest.webmanifest',
  './icons/icon.svg',
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

/* Что всегда идёт из сети: внешние API (свои TTL и свой кэш в localStorage)
   и тайлы. Всё остальное — сеть с фолбэком в кэш оболочки. */
const NETWORK_ONLY = /(open-meteo\.com|overpass|private\.coffee|kumi\.systems|arcgisonline|tile\.openstreetmap|opentopomap)/;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (NETWORK_ONLY.test(url.hostname)) return;

  // NETWORK-FIRST: всегда свежая версия файлов, кэш — только офлайн-фолбэк.
  // (Раньше была стратегия cache-first — из-за неё после замены файлов
  //  сайт продолжал показывать старую версию.)
  e.respondWith(
    fetch(e.request).then(res => {
      /* кэшируем только то, что реально лежит в оболочке: иначе в Cache
         оседали случайные запросы (404-ы, /favicon.ico, devtools-пути) */
      const wanted = SHELL.some(u => u === './' || url.pathname.endsWith(u.replace(/^\.\//, '/')));
      if (res && res.status === 200 && (url.origin === self.location.origin || wanted)){
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(hit => {
      if (hit) return hit;
      /* офлайн и файла нет в кэше — отдаём index.html, чтобы PWA
         открывался на любой точке (в т.ч. после смены версии) */
      return url.mode === 'navigate' ? caches.match('./index.html') : Response.error();
    }))
  );
});

/* Страница просит сообщить о новой версии — перепроверяем SW по возврату
   на вкладку, а не раз в сутки, как в дефолте браузера. */
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
