/* ловим всё, что упало позже boot(): обработчик вешается ДО старта,
   иначе ошибка в buildUI() осталась бы незафиксированной */
window.addEventListener('error', e => console.error('Ошибка страницы:', e.error || e.message));

/* ============================================================
   МОДЕЛЬ (model.js) — чистые расчётные функции вынесены в отдельный
   файл, чтобы их можно было проверять автотестами в node.
   model.js загружается раньше app.js (см. index.html).
   ============================================================ */
const {
  simulate, syntheticData: gesSynthetic, releaseCalculate, movingAverage,
  scenarioFactor, damBreakView, alignIndex, buildTimeIndex,
  applyReservoirScenario, shorelineRings,
  dayOfYear, daysInMonth, utcToISO, todayISO,
  num: fmtNum, fmtMW, fmtAxisPower, fmtEnergyKWh, fmtDateRu, isoToUTC
} = window.GES;

/* Пользователь просит меньше движения — пропускаем анимации волны
   и плавные перелёты карты, рисуем сразу конечное состояние. */
const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   ПАСПОРТНЫЕ ДАННЫЕ ГЭС
   flowDir — направление течения вниз по реке (0=С, 90=В, 180=Ю).
   ============================================================ */
const HPPS = [
  /* Малые ГТС Карельского перешейка (Выборгский р-н). Данные: файл пользователя
     «Данные ГЭС.docx»; координаты плотин: OSM/Wikimapia/vokrug-ladogi.ru.
     Поля, по которым в паспорте «нет данных», помечены «~» (рабочая оценка для модели). */
  {id:'krav', name:'Кравцовская МГЭС', river:'Селезнёвка', lat:60.7680, lon:28.5707, flowDir:115,
   capacityMW:0.2, powerLabel:'нет данных (~0,2 МВт)', head:2.5, nmu:10.5, umo:8, areaNMU:0.03,
   totalVolume:0.00008, usefulVolume:0.00002, eff:.82, year:1943, visMinW:30, terrainAmpl:50,
   reservoirName:'пруд Кравцовской МГЭС', damH:3, breachW:29, chanW0:8, chanW1:45,
   damType:'IV класс, гребень 29×1 м, напор 2,5 м (82 года эксплуатации)',
   note:'с 2025 г. идёт демонтаж старой плотины'},
  /* 60.71815, 28.1786 (навигационная точка Wikimapia) лежала на грунтовке в
     ~150 м восточнее воды — метка «съезжала» с реки. Новая точка — створ на
     центрлинии OSM у здания станции (OSM way 851438381 «Андреевская ГЭС»,
     60.7179069, 28.1763864 — в 31 м); русло ниже по течению стартует отсюда. */
  {id:'andr', name:'Андреевская ГЭС', river:'Андреевка (Тукалус-Йоки)', lat:60.71783, lon:28.17585, flowDir:170,
   capacityMW:0.6, powerLabel:'0,6 МВт', head:7, nmu:99, umo:96.5, areaNMU:0.045,
   totalVolume:0.00012, usefulVolume:0.00004, eff:.85, year:1950, visMinW:30, terrainAmpl:50,
   reservoirName:'пруд Андреевской ГЭС', damH:2.5, breachW:20, chanW0:6, chanW1:35,
   damType:'каменная кладка 2–3 м, деривационная',
   note:'НПУ 99 м — условная отметка; проект реконструкции 2021 г.'},
  {id:'pero', name:'Перовская МГЭС («Феррариа»)', river:'Перовка', lat:60.67992, lon:28.95119, flowDir:295,
   capacityMW:0.15, powerLabel:'нет данных (~0,15 МВт)', head:5.5, nmu:17.5, umo:12, areaNMU:0.03,
   totalVolume:0.00008, usefulVolume:0.00002, eff:.82, year:1905, visMinW:35, terrainAmpl:50,
   reservoirName:'пруд Перовской МГЭС', damH:10, breachW:27, chanW0:10, chanW1:55,
   damType:'двухсекционный водосброс, деревянные щиты, ≈10 м',
   note:''},
  {id:'igla', name:'Плотина затопления «Игла»', river:'Перовка', lat:60.52897, lon:29.16467, flowDir:315,
   capacityMW:0, powerLabel:'не ГЭС', notHPP:true, head:3, nmu:52.5, umo:47, areaNMU:0.14,
   totalVolume:0.0004, usefulVolume:0.0001, eff:.8, year:1938, visMinW:45, terrainAmpl:50,
   reservoirName:'зона затопления (несколько км)', damH:5.5, breachW:60, chanW0:12, chanW1:60,
   damType:'плотина затопления, 1938 г., тело >5 м',
   note:'создаёт многокилометровую зону затопления'},
  {id:'rokk', name:'Плотина хутора Роккаланмяки (руины)', river:'Птичья', lat:60.2913, lon:29.8017, flowDir:290,
   capacityMW:0.05, powerLabel:'нет данных (лесопильня)', head:1.25, nmu:74.5, umo:73, areaNMU:0.01,
   totalVolume:0.00002, usefulVolume:0.000005, eff:.8, year:1930, visMinW:22, terrainAmpl:80,
   reservoirName:'пруд хутора Роккаланмяки', damH:1.5, breachW:15, chanW0:4, chanW1:25,
   damType:'щитовая, 2–3 пролёта, один разрушен; подъём 1–1,5 м',
   note:''},
  {id:'alak', name:'Алакусская ГЭС', river:'Пчелинка', lat:60.6077, lon:29.5165, flowDir:335,
   capacityMW:0.1, powerLabel:'нет данных (~0,1 МВт)', head:2, nmu:22, umo:20, areaNMU:0.04,
   totalVolume:0.0001, usefulVolume:0.00003, eff:.83, year:1948, visMinW:32, terrainAmpl:50,
   reservoirName:'Алакусский пруд', damH:2, breachW:25, chanW0:6, chanW1:40,
   damType:'плотина 1948 г. (строители — студенты ЛПИ им. Калинина)',
   note:''}
];
const PRIORITY = ['krav','andr','pero','igla','rokk','alak'];
const HISTORY_START = '2023-01-01';
const CHART_WINDOW = 60;
const CHART_THROTTLE_MS = 80;
const SHOW_DECORATIVE_WAVE = false;   // декоративная волна (широкий коридор) отключена

/* Шероховатость русла в 1D-модели прорыва. Единственное место, где она
   задаётся: подпись в паспорте станции берётся отсюда же, из-за чего
   расхождение «в UI 0,035, в коде 0,04» больше невозможно. */
const MANNING_N = 0.04;

/* ============================================================
   НАСТРОЙКИ ВОЛНЫ
   WAVE_SCALE = 1.0 — общий масштаб волны (1.0 = полный размер,
   ширины рассчитаны под реальные поймы рек).
   ============================================================ */
const WAVE_SCALE = 1.0;

/* ============================================================
   КАРТА (Leaflet)
   ============================================================ */
/* attributionControl выключен и добавлен вручную с prefix:false —
   убирает префикс «🇺🇦 Leaflet», но СОХРАНЯЕТ копирайты OSM/OTM/Esri. */
const map = L.map('map', { zoomControl:true, preferCanvas:true, attributionControl:false })
  .setView([60.62, 28.75], 9);
L.control.attribution({ position:'bottomright', prefix:false }).addTo(map);
/* Обязательная атрибутика по лицензии ODbL для контуров водохранилищ,
   русел и высот DEM — в README её мало, она должна быть на карте. */
map.attributionControl.addAttribution(
  'Русла и контуры: © OpenStreetMap contributors (ODbL) · рельеф: Open-Meteo Elevation (SRTM/GMTED) · климат: CMIP6 (CC BY 4.0)');

const baseLayers = {
  '🌍 OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom:18, attribution:'© OpenStreetMap' }),
  '⛰ Рельеф (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom:17, attribution:'© OpenTopoMap, SRTM' }),
  '🛰 Спутник (Esri)': L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom:18, attribution:'© Esri, Maxar' })
};
baseLayers['⛰ Рельеф (OpenTopoMap)'].addTo(map);
L.control.layers(baseLayers, null, { position:'topright' }).addTo(map);

const layerRes     = L.layerGroup().addTo(map);
const layerFloodZone = L.layerGroup().addTo(map); // зона затопления (под волной)
const layerFlood   = L.layerGroup().addTo(map);
const layerMarkers = L.layerGroup().addTo(map);

/* хелпер полигона в стиле Leaflet-вызовов: кольцо [ [lat,lon], ... ] */
function polyAdd(collection, ring, o){
  try { return polyAddUnsafe(collection, ring, o); }
  catch(e){ console.warn('polyAdd:', e.message); return null; }
}
function polyAddUnsafe(collection, ring, o){
  if (!collection || !Array.isArray(ring) || ring.length < 3) return null;
  /* замкнуть кольцо и выкинуть NaN */
  ring = ring.filter(p => p && isFinite(p[0]) && isFinite(p[1]));
  if (ring.length < 3) return null;
  if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) ring = ring.concat([ring[0]]);
  const p = L.polygon(ring, {
    color: o.color || '#ffffff', weight: o.weight ?? 1.5, opacity: o.opacity ?? 0.9,
    fillColor: o.fill || o.fillColor || '#000000', fillOpacity: o.fillOpacity ?? 0.3,
    dashArray: o.dash ? '7 5' : null, interactive: false
  });
  p.addTo(collection);
  return p;
}
function clear(coll){ if (coll) coll.clearLayers(); }

/* Панорама так, чтобы станция оказалась НЕ под панелями. Раньше в коде
   стояли «на глаз» 260/450 px и комментарий про 62% ширины — теперь
   берём реальные размеры панелей (они перетаскиваются и ресайзятся). */
function panelInsets(){
  const sz = map.getSize();
  const rect = el => (el && getComputedStyle(el).display !== 'none') ? el.getBoundingClientRect() : null;
  const sb = rect($('sidebar'));
  const cp = $('chartPanel').classList.contains('show') ? rect($('chartPanel')) : null;
  const left = sb ? Math.min(sz.x * 0.45, sb.right + 10) : 12;
  const right = cp ? Math.min(sz.x * 0.55, sz.x - cp.left + 10) : 12;
  return { left, right };
}
/* Границы «станции»: створ плотины + чаша (реальный контур) + верхние 2 км
   русла ниже плотины. Раньше при выборе ГЭС был только перелёт на точку с
   z=7: на обзоре полукилометровый пруд остаётся точкой между зданиями — ни
   зеркала, ни русла, куда пойдёт волна, не видно. */
const STATION_REACH_M = 2000;        /* сколько русла ниже плотины брать в кадр */
const STATION_ZOOM_MAX = 16;         /* ближе не надо: пруд ~0,3 км², дальше — поля */
const STATION_ZOOM_MIN = 13;

function stationBounds(h){
  let la0 = h.lat, la1 = h.lat, lo0 = h.lon, lo1 = h.lon;
  const eat = (la, lo) => {
    if (!isFinite(la) || !isFinite(lo)) return;
    if (la < la0) la0 = la;
    if (la > la1) la1 = la;
    if (lo < lo0) lo0 = lo;
    if (lo > lo1) lo1 = lo;
  };
  const g = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
  if (g){
    /* данные отдают и «список колец», и «одно кольцо» — приводим к списку
       (тот же признак, что в model.js:ringList — кольцо это массив пар, а
       список колец — массив массивов пар) */
    const src = Array.isArray(g) ? g : (g.n || []);
    const ringsIn = Array.isArray(src[0] && src[0][0]) ? src : [src];
    for (const ring of ringsIn) for (const pt of (ring || [])) eat(pt && pt[0], pt && pt[1]);
  }
  const c = S.riverCourses[h.id];
  if (c && c.length > 1){
    let acc = 0;
    for (let i = 1; i < c.length && acc < STATION_REACH_M; i++){
      eat(c[i][0], c[i][1]);
      acc += haversineM(c[i-1][0], c[i-1][1], c[i][0], c[i][1]);
    }
  }
  /* схлопнутую в точку рамку не раздуваем: за «не слишком близко» держит
     STATION_ZOOM_MAX — иначе мы бы показали чужие поля вместо реальных границ */
  return [[la0, lo0], [la1, lo1]];
}

function panToStation(h, zoom){
  const { left, right } = panelInsets();
  const opts = {
    paddingTopLeft: [left + 10, 90], paddingBottomRight: [right + 10, 120],
    maxZoom: zoom || STATION_ZOOM_MAX, minZoom: STATION_ZOOM_MIN
  };
  const bnds = stationBounds(h);
  if (REDUCED_MOTION) map.fitBounds(bnds, opts);
  else map.flyToBounds(bnds, Object.assign({ duration: 0.7 }, opts));
}

/* Минимальная ЭКРАННАЯ ширина волны/зоны: на обзорном масштабе (z≈8-10,
   ~450 м/пикс) реальная лента 100-500 м тоньше пикселя и невидима. */
function visWidths(w, floor){
  const out = new Float32Array(w.length);
  for (let k = 0; k < w.length; k++) out[k] = w[k] > 1 ? Math.max(w[k], floor) : 0;
  return out;
}
/* Пол «минимальной видимой ширины» привязан к масштабу. Раньше это было
   плоское h.visMinW (22 м у Роккаланмяки, 500 м по умолчанию) — на обзоре
   оправданное, но на крупном плане (z≥15, ~1 м/пикс) оно превращало ручеёк
   в 200-метровый прямоугольник через поля: волна «рисовалась не по реке».
   Теперь пол = ~3 пикселя текущего зума, но не больше visMinW станции. */
function visFloor(h){
  const cap = h.visMinW || 500;
  const z = (map && map.getZoom) ? map.getZoom() : 12;
  const mPerPx = 156543.03392 * Math.abs(Math.cos(((h.lat || 60) * Math.PI) / 180)) / Math.pow(2, z);
  return Math.min(cap, Math.max(6, 3 * mPerPx));
}

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
const S = {
  mode:'history', scenario:'normal',
  dates:[], results:{}, cache:{}, sources:{},
  timeIdx:{}, timeLen:{},        // привязка ряда станции к единой дате (model.js)
  markers:{}, reservoirs:{},
  idx:0, playing:false, selected:null,
  cardKey:'', cardTimer:0, lastCardUpdate:0,   // троттлинг карточки при перемотке
  chartPower:null, chartLevel:null,
  lastChartUpdate:0, loading:false, damBreak:null,
  riverCourses:{}, reservoirsOSM:{},
  loadingRiver:{}, loadingRes:{}, loadingStation:{}
};

let animAcc = 0, animLast = 0;
let apiAvailable = null;

/* ============================================================
   УТИЛИТЫ
   ============================================================ */
const $ = id => document.getElementById(id);
const setStatus = h => { $('statusText').innerHTML = h; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Временное сообщение в статусе. Прежняя версия возвращала «prev»,
   прочитанный в момент вызова: два сообщения подряд восстанавливали
   устаревший текст. Теперь показ стеком — каждое сообщение доедает
   свой таймер и снимается только то, что действительно активно. */
let statusStack = [];
function showStatusMsg(msg, ms = 3000){
  const el = $('statusText');
  if (!statusStack.length) statusStack.push(el.innerHTML);
  statusStack.push('<span class="warn">' + msg + '</span>');
  el.innerHTML = statusStack[statusStack.length - 1];
  setTimeout(() => {
    const at = statusStack.lastIndexOf(el.innerHTML);
    if (at > 0){ statusStack.splice(at, 1); el.innerHTML = statusStack[statusStack.length - 1]; }
    else if (at === 0){ statusStack = []; }
  }, ms);
}

/* Единая точка «станция получила ряд»: результат модели + индекс дат.
   Индекс нужен, чтобы индексы бегунка не читались напрямую в ряду
   другой длины (месячный климат vs суточная история vs синтетика). */
function setStationSeries(h, mode, data, source){
  if (mode) S.cache[mode][h.id] = data;
  if (source) S.sources[h.id] = source;
  S.timeIdx[h.id] = buildTimeIndex(data && data.hydro ? data.hydro.time : null);
  S.results[h.id] = simulate(h, data.hydro, data.clim);
  S.timeLen[h.id] = S.results[h.id].level.length;
  return S.results[h.id];
}

/* Индекс ряда станции для текущей даты бегунка; -1 — данных нет. */
function ki(h){
  return alignIndex(S.idx, S.timeLen[h.id] || 0, S.timeIdx[h.id], S.dates[S.idx]);
}

function haversineM(a,b,c,d){
  const R=6371000, dLat=(c-a)*Math.PI/180, dLon=(d-b)*Math.PI/180;
  const x=Math.sin(dLat/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

function courseLength(c){
  let L=0;
  for (let i=1;i<c.length;i++) L += haversineM(c[i-1][0],c[i-1][1],c[i][0],c[i][1]);
  return L;
}

function trimCourse(c, maxLen){
  if (c.length < 2) return c;
  const out=[c[0]]; let L=0;
  for (let i=1;i<c.length;i++){
    const d=haversineM(c[i-1][0],c[i-1][1],c[i][0],c[i][1]);
    if (L+d>maxLen){
      const t=(maxLen-L)/d;
      out.push([c[i-1][0]+(c[i][0]-c[i-1][0])*t, c[i-1][1]+(c[i][1]-c[i-1][1])*t]);
      return out;
    }
    out.push(c[i]); L+=d;
  }
  return out;
}

async function fetchWithTimeout(url, ms=10000, opts={}){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), ms);
  try {
    const r = await fetch(url, {signal:ctrl.signal, ...opts});
    if (r.status === 429){ const e=new Error('429'); e.is429=true; throw e; }
    if (!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function fetchWithRetry(url, ms=10000, tries=2){
  let lastErr;
  for (let k=0;k<tries;k++){
    try { return await fetchWithTimeout(url, ms); }
    catch(e){ lastErr=e; await sleep((e.is429?4000:800)*(k+1)); }
  }
  throw lastErr;
}

/* ============================================================
   КЭШ
   ============================================================ */
const CACHE_KEY = 'ges_cache_v19';
const RIVER_KEY_PREFIX = 'ges_river_v7_';
const RES_KEY_PREFIX   = 'ges_res_v7_';
const TTL = { history:12*3600*1000, forecast:30*60*1000, climate:7*24*3600*1000 };

/* localStorage читаем/парсим ОДИН раз и держим снимок в памяти: раньше
   getCached/getStaleCached/setCached на каждую станцию делали JSON.parse
   всего блока (0.5-1 МБ на history) — 5 парсов на загрузку режима.
   Запись — write-behind: помечаем грязным и сбрасываем пачкой. */
let cacheMem = null;         // снимок блока
let cacheDirty = false;
let cacheFlushTimer = 0;

function cacheSnapshot(){
  if (cacheMem === null){
    try { cacheMem = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch(e){ cacheMem = {}; }
    if (!cacheMem || typeof cacheMem !== 'object') cacheMem = {};
  }
  return cacheMem;
}
function markCacheDirty(){
  cacheDirty = true;
  if (cacheFlushTimer) return;
  const flush = () => {
    cacheFlushTimer = 0;
    if (!cacheDirty) return;
    cacheDirty = false;
    writeCacheAll(cacheSnapshot());
  };
  if ('requestIdleCallback' in window) cacheFlushTimer = requestIdleCallback(flush, { timeout: 2000 });
  else cacheFlushTimer = setTimeout(flush, 400);
}
function invalidateCacheSnapshot(){ cacheMem = null; }
window.addEventListener('pagehide', () => {
  if (cacheDirty){ cacheDirty = false; writeCacheAll(cacheSnapshot()); }
});

function writeCacheAll(o){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(o)); }
  catch(e){
    /* квота кончилась — выкидываем самый старый режим и пробуем ещё раз */
    try {
      const keys = Object.keys(o);
      if (keys.length > 1){ delete o[keys[0]]; localStorage.setItem(CACHE_KEY, JSON.stringify(o)); }
      else localStorage.removeItem(CACHE_KEY);
    } catch(_){}
  }
}
function getCached(mode,id){
  const e = cacheSnapshot()[mode]?.[id];
  if(!e) return null;
  if(Date.now()-e.ts > TTL[mode]) return null;
  return e.data;
}
function getCacheEntryTS(mode,id){
  const e = cacheSnapshot()[mode]?.[id];
  return e ? e.ts : 0;
}
function getStaleCached(mode,id){
  const e = cacheSnapshot()[mode]?.[id];
  return e ? e.data : null;
}
function compressData(data){
  return {
    hydro: { time: data.hydro.time, q: data.hydro.q.map(v => v==null?null:Math.round(v)) },
    clim: { time: data.clim.time,
      t: data.clim.t.map(v => v==null?null:Math.round(v*10)/10),
      p: data.clim.p.map(v => v==null?null:Math.round(v*10)/10) },
    meta: data.meta || null
  };
}
function setCached(mode,id,data){
  const a = cacheSnapshot(); if(!a[mode]) a[mode]={};
  a[mode][id]={ ts:Date.now(), data: compressData(data) };
  markCacheDirty();
}

/* ============================================================
   ПРОВЕРКА API
   ============================================================ */
/* Проверяем ВСЕ используемые хосты Open-Meteo параллельно: доступность =
   ответил хотя бы один. Одиночный короткий пинг, как раньше, при любой
   сетевой заминке навсегда помечал приложение "офлайн". */
let lastApiError = '';
async function pingAPI(){
  const probes = [
    'https://api.open-meteo.com/v1/forecast?latitude=55&longitude=37&daily=temperature_2m_mean&forecast_days=1',
    'https://archive-api.open-meteo.com/v1/archive?latitude=55&longitude=37&start_date=2024-01-01&end_date=2024-01-03&daily=temperature_2m_mean',
    'https://flood-api.open-meteo.com/v1/flood?latitude=55&longitude=37&daily=river_discharge&forecast_days=1'
  ].map(u => fetchWithTimeout(u, 8000));
  try {
    await Promise.any(probes);
    apiAvailable = true;
  } catch(e){
    apiAvailable = false;
    lastApiError = (e && e.errors && e.errors[0] && e.errors[0].message) || '';
    console.warn('Open-Meteo недоступен:', lastApiError || e);
  }
  ensureOfflineRetry();
}

/* Пока API недоступен — каждые 30 с молча перепроверяем; как только сеть
   вернулась, автоматически докачиваем данные текущего режима и ТУШИМ
   таймер (раньше интервал жил до перезагрузки страницы). */
let offlineRetryTimer = null;
function ensureOfflineRetry(){
  if (apiAvailable !== false){
    if (offlineRetryTimer){ clearInterval(offlineRetryTimer); offlineRetryTimer = null; }
    return;
  }
  if (offlineRetryTimer) return;
  offlineRetryTimer = setInterval(async () => {
    if (apiAvailable !== false) return;
    await pingAPI();
    if (apiAvailable === true && !S.loading) loadPeriod(S.mode);
  }, 30000);
}

/* ============================================================
   OVERPASS
   ============================================================ */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

async function overpassQuery(query, timeoutMs = 18000){
  const attempts = OVERPASS_MIRRORS.map(async m => {
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(), timeoutMs);
    try {
      const r=await fetch(m, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'data='+encodeURIComponent(query),
        signal:ctrl.signal
      });
      if (!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    } catch(e){ console.warn('Overpass '+m+': '+e.message); throw e; }
    finally { clearTimeout(t); }
  });
  try {
    return await Promise.any(attempts);
  } catch(e){
    throw new Error('Overpass недоступен (все зеркала)');
  }
}

/* ============================================================
   РУСЛО — фолбэк + зеркалирование долготы
   ============================================================ */
function makeFallbackCourse(h, maxDistM){
  const points = [[h.lat, h.lon]];
  const n = 80;
  const step = maxDistM / n;
  const baseDir = (h.flowDir || 180) * Math.PI / 180;
  const R = 6371000;
  const latR = h.lat * Math.PI / 180;
  const seed = h.lat * 37 + h.lon * 11;

  let lat = h.lat, lon = h.lon;

  for (let i = 1; i <= n; i++){
    const t = i / n;
    const meander =
      Math.sin(t * Math.PI * 2.5 + seed)        * 0.55 +
      Math.sin(t * Math.PI * 5.7 + seed * 1.3)  * 0.30 +
      Math.sin(t * Math.PI * 11  + seed * 2.1)  * 0.15;

    const dir = baseDir + meander;
    const dLat = step * Math.cos(dir);
    const dLon = step * Math.sin(dir);

    lat += dLat / R * 180 / Math.PI;
    lon += dLon / (R * Math.cos(latR)) * 180 / Math.PI;
    points.push([lat, lon]);
  }

  return points;
}

async function loadRiverCourse(h){
  const params = getWaveParams(h);

  /* 0. Встроенное настоящее русло (rivers-data.js, снимок OSM) — приоритет:
     всегда точное, доступно мгновенно и офлайн */
  const emb = (typeof RIVER_COURSES !== 'undefined') ? RIVER_COURSES[h.id] : null;
  if (emb && emb.length >= 3){
    console.log(`Русло ${h.name} — встроенное (${emb.length} точек)`);
    return trimCourse(emb, params.maxDist * 1.4);
  }

  /* 1. Кэш */
  const key = RIVER_KEY_PREFIX + h.id;
  try {
    const raw = localStorage.getItem(key);
    if (raw){
      const c = JSON.parse(raw);
      if (Date.now()-c.ts < 30*24*3600*1000 && Array.isArray(c.course) && c.course.length >= 3){
        console.log(`Русло ${h.name} — из кэша (${c.course.length} точек)`);
        return c.course;
      }
    }
  } catch(e){}
  const RADIUS = Math.min(Math.round(params.maxDist * 1.3), 45000);

  /* 2. Пытаемся получить из OSM */
  let osmCourse = null;
  try {
    const query = `[out:json][timeout:25];
way(around:${RADIUS},${h.lat},${h.lon})["waterway"~"river|canal"];
out geom;`;

    const data = await overpassQuery(query, 20000);

    const ways = (data.elements || [])
      .filter(el => el.geometry && el.geometry.length >= 2)
      .map(el => ({
        geom: el.geometry.map(p => [p.lat, p.lon]),
        name: (el.tags?.name || '').toLowerCase(),
        used: false
      }));

    if (ways.length){
      /* Ищем стартовый сегмент рядом с плотиной, отдавая приоритет
         объектам, чьё название OSM совпадает с рекой станции —
         это отсекает попадание на соседний канал/старицу/приток. */
      const riverName = (h.river || '').toLowerCase();
      let best = null;
      ways.forEach(w => {
        const nameMatch = riverName && w.name.includes(riverName);
        for (let i=0;i<w.geom.length;i++){
          const d = haversineM(h.lat, h.lon, w.geom[i][0], w.geom[i][1]);
          if (d > 3000) continue;
          const score = d - (nameMatch ? 2000 : 0); // бонус за совпадение имени реки
          if (!best || score < best.score) best = { w, idx:i, score };
        }
      });

      if (best){
        best.w.used = true;
        const g = best.w.geom, idx = best.idx;
        const cosLat = Math.cos(h.lat * Math.PI / 180);
        const flowRad = (h.flowDir || 180) * Math.PI / 180;
        const fLat = Math.cos(flowRad), fLon = Math.sin(flowRad);

        const idxA = Math.min(idx + 5, g.length - 1);
        const idxB = Math.max(idx - 5, 0);
        const dotA = (g[idxA][0]-g[idx][0])*fLat + (g[idxA][1]-g[idx][1])*fLon*cosLat;
        const dotB = (g[idxB][0]-g[idx][0])*fLat + (g[idxB][1]-g[idx][1])*fLon*cosLat;
        const downstream = dotA >= dotB ? g.slice(idx) : g.slice(0, idx + 1).reverse();

        let chain = [ [h.lat, h.lon], ...downstream ];
        let segCount = 1;

        /* Сшиваем цепочку из соседних объектов OSM, чей конец совпадает
           с текущим концом маршрута — так волна идёт по настоящему
           непрерывному руслу, а не обрывается на границе одного объекта. */
        let guard = 0;
        while (guard++ < 25 && courseLength(chain) < params.maxDist * 1.3){
          const tail = chain[chain.length - 1];
          let match = null, matchRev = false, matchD = 400;
          for (const w of ways){
            if (w.used) continue;
            const gs = w.geom[0], ge = w.geom[w.geom.length-1];
            const dStart = haversineM(tail[0], tail[1], gs[0], gs[1]);
            const dEnd = haversineM(tail[0], tail[1], ge[0], ge[1]);
            if (dStart < matchD){ match = w; matchRev = false; matchD = dStart; }
            if (dEnd   < matchD){ match = w; matchRev = true;  matchD = dEnd; }
          }
          if (!match) break;
          match.used = true;
          const seg = matchRev ? [...match.geom].reverse() : match.geom;
          chain = chain.concat(seg.slice(1));
          segCount++;
        }

        if (chain.length >= 3){
          osmCourse = chain;
          console.log(`Русло ${h.name} — OSM: ${osmCourse.length} точек, сшито из ${segCount} сегмент(ов)`);
        }
      }
    }
  } catch(e){
    console.warn(`OSM-русло ${h.name} не удалось: ${e.message}`);
  }

  /* 3. Если OSM не дал — фолбэк */
  if (!osmCourse){
    osmCourse = makeFallbackCourse(h, params.maxDist * 1.5);
    console.log(`Русло ${h.name} — фолбэк (${osmCourse.length} точек)`);
  }

  /* 4. Обрезаем и кэшируем */
  const course = trimCourse(osmCourse, params.maxDist * 1.4);
  try { localStorage.setItem(key, JSON.stringify({ ts:Date.now(), course })); } catch(e){}
  return course;
}


/* ============================================================
   УЧЕБНЫЙ СЦЕНАРИЙ «ДОПОЛНИТЕЛЬНЫЙ СБРОС» — Перовская МГЭС
   Точная реализация алгоритма пользователя
   (Перовка_финальный_алгоритм.js / Перовка_ИТОГ_расчёт_и_пояснения.xlsx):
   каскад линейных резервуаров, треугольный гидрограф, dt=30 с, горизонт 12 ч.
   Зона затопления НЕ рассчитывается (по ограничениям исходной модели).
   ============================================================ */
const RELEASE = {
  station: 'pero',
  cfg: { area_m2: 15510, mean_drawdown_m: 0.10, background_m3s: 1.79,
         duration_s: 3600, peak_time_s: 1200, dt_s: 30, speed_parameter_ms: 1,
         horizon_s: 43200 },
  points: [
    [0,60.679924,28.950886], [503,60.682763,28.954423],
    [1000,60.686019,28.955504], [1500,60.689338,28.951666],
    [2000,60.692894,28.948601], [2500,60.696733,28.946009],
    [3000,60.699537,28.939458]
  ],
  /* состояние активного сценария: маркеры участков и окно у плотины.
     Держим здесь (а не в S), потому что чистит их stopRelease() */
  reachMarkers: null,
  popup: null
};

/* Алгоритм — model.js:releaseCalculate, копию с вырезанной валидацией
   держать нельзя: эталон «Перовка_финальный_алгоритм.js» проверяет и
   параметры, и кратность горизонта шагу, и замыкание водного баланса.
   Проверка паритета рядов — в tests/model.test.mjs. */

function fmtClock(sec){
  const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60);
  return (hh ? hh + 'ч ' : '') + mm + 'м';
}

/* Leaflet привязывает поповер НИЖНИМ краем (в _updatePosition пишется
   style.bottom = -(y + offset.y)), поэтому любое окно по умолчанию висит НАД
   точкой. На Перовской при учебном сбросе именно там стоят маркер плотины и
   подпись станций, и окно их накрывало. Решается сдвигом на собственную
   высоту: offset.y = высота контейнера + зазор на «хвост», а сам хвост
   переворачивает CSS-класс .pop-under (см. style.css).
   setOffset() в Leaflet 1.9 нет — пишем опцию и зовём update(). */
const POPUP_TIP_GAP = 7;      // дефолтный offset.y у L.popup
function placePopupUnder(pop){
  const el = pop.getElement && pop.getElement();
  if (!el) return false;
  const h = el.getBoundingClientRect().height || el.offsetHeight || 0;
  const off = [0, h + POPUP_TIP_GAP];
  if (String(pop.options.offset) === String(off)) return false;   // без дребезга на rAF
  pop.options.offset = off;
  pop.update();
  return true;
}

/* Куда ставить окно относительно створа — решает НЕ пожелание «снизу», а
   направление движения воды: окно обязано остаться с противоположной стороны,
   иначе оно ложится ровно на русло, по которому бежит волна (на юг → окно
   сверху, на север → снизу). Знак снимаем с первых ~600 м РЕАЛЬНОГО русла
   (S.riverCourses / ряд участка сброса), а не со справочной flowDir: русло
   кривое, и анимируется именно оно. flowDir — только запасной вариант, когда
   курса ещё нет. У Перовской первые 600 м русла идут на север, поэтому там
   окно остаётся снизу — прежнее поведение сохранено. */
const POPUP_GAP_ABOVE = 12;     // зазор «точка → окно», когда окно сверху
const FLOW_PROBE_M = 600;       // по скольким метрам русла меряем направление тока

/* Смещение воды за первые FLOW_PROBE_M м русла, в метрах: [восток, север].
   Курс может лежать в массиве и «от створа», и «к створу» — ориентируемся по
   расстоянию до точки плотины. */
function waveShift(h, course){
  const pts = (Array.isArray(course) && course.length >= 3) ? course : null;
  if (pts){
    const dTo = p => haversineM(p[0], p[1], h.lat, h.lon);
    const fwd = dTo(pts[0]) <= dTo(pts[pts.length-1]);
    const last = pts.length - 1;
    let i = fwd ? 0 : last, acc = 0;
    while ((fwd ? i < last : i > 0) && acc < FLOW_PROBE_M){
      const j = fwd ? i+1 : i-1;
      acc += haversineM(pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      i = j;
    }
    if (acc > 50){
      const a = pts[fwd ? 0 : last], b = pts[i];
      const mPerDegLat = 111320;
      return [ (b[1]-a[1]) * mPerDegLat * Math.cos(a[0] * Math.PI/180), (b[0]-a[0]) * mPerDegLat ];
    }
  }
  const fd = ((h.flowDir != null ? h.flowDir : 180)) * Math.PI / 180;
  return [ Math.sin(fd) * 1000, Math.cos(fd) * 1000 ];
}

/* Сторона, на которой встанет окно: ПРОТИВ движения воды и по главной оси
   тока (река на восток → окно слева, на юг → сверху, …) */
function popSideForFlow(h, course){
  const [dE, dN] = waveShift(h, course);
  if (Math.abs(dN) >= Math.abs(dE)) return dN < 0 ? 'above' : 'under';
  return dE > 0 ? 'left' : 'right';
}

/* measure → offset. Leaflet привязывает окно нижним краем: +offset.y тянет его
   вниз, +offset.x — вправо. Отсюда для «под точкой» смещение = высота, для
   «над» — минус зазор, для боковых — половина ширины (и окно центрируется по
   точке по вертикали). */
function placePopupAt(pop, side){
  const el = pop.getElement && pop.getElement();
  if (!el) return false;
  if (side === 'under') return placePopupUnder(pop);
  const r = el.getBoundingClientRect();
  const w = r.width || el.offsetWidth || 0, h = r.height || el.offsetHeight || 0;
  let off = null;
  if (side === 'left' && w)  off = [-(w/2 + POPUP_TIP_GAP), h/2 + POPUP_TIP_GAP];
  if (side === 'right' && w) off = [ (w/2 + POPUP_TIP_GAP), h/2 + POPUP_TIP_GAP];
  if (side === 'above')      off = [0, -POPUP_GAP_ABOVE];
  if (!off || String(pop.options.offset) === String(off)) return false;
  pop.options.offset = off;
  pop.update();
  return true;
}

/* Открыть окно у точки — общий вход для прорыва и сброса */
function openPopAt(latLng, html, opts, side){
  const pop = L.popup(Object.assign({
    maxWidth: 240, autoPan: false, closeButton: false,
    className: 'breakPop pop-' + side, offset: [0, side === 'under' ? 12 : -POPUP_GAP_ABOVE]
  }, opts || {})).setLatLng(latLng).setContent(html).openOn(map);
  placePopupAt(pop, side);
  requestAnimationFrame(() => placePopupAt(pop, side));
  return pop;
}

async function startRelease(){
  const p = RELEASE;
  if (S.selected !== p.station){
    showStatusMsg('Сценарий «Сброс» построен для Перовской МГЭС — переключаю на неё');
    await selectHPP(p.station, true);
  }
  stopDamBreak();
  const h = HPPS.find(x => x.id === p.station);
  /* releaseCalculate (model.js) проверяет параметры, кратность горизонта
     шагу и замыкание водного баланса — при мусоре в cfg падаем явно,
     с человекочитаемым текстом в статусе, а не рисуем молча что попало */
  let res;
  try {
    res = releaseCalculate(p.cfg, p.points);
  } catch(e){
    showStatusMsg('Сценарий сброса: ' + e.message);
    return;
  }
  /* dur — вся анимация; 12 ч модельного времени укладываем в 30 с. */
  S.release = { res, start: performance.now(), dur: REDUCED_MOTION ? 1500 : 30 * 1000, lastN: -1, lastTips: 0 };
  clear(layerFlood); clear(layerFloodZone);

  /* русло участка (плотина → 3 км) */
  const line = p.points.map(pt => [pt[1], pt[2]]);
  L.polyline(line, { color:'#31c9ff', weight:3, opacity:0.9, interactive:false }).addTo(layerFloodZone);
  p.reachMarkers = p.points.slice(1).map((pt, j) => {
    const mk = L.circleMarker([pt[1], pt[2]], {
      radius: 7, color:'#ffffff', weight:2, fillColor:'#1a4a6b', fillOpacity:0.95
    }).addTo(layerFlood);
    mk.bindTooltip('', { permanent:true, direction:'top', offset:[0,-8], className:'qtip' });
    return mk;
  });

  /* зум на участок */
  const la = line.map(q => q[0]), lo = line.map(q => q[1]);
  const bounds = [[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]];
  const pad = { paddingTopLeft: [380, 90], paddingBottomRight: [460, 120] };
  if (REDUCED_MOTION) map.fitBounds(bounds, pad);
  else map.flyToBounds(bounds, Object.assign({ duration: 0.8 }, pad));

  /* паспорт сценария у плотины — числа из расчёта, а не прописанные в разметке */
  setTimeout(() => {
    const pop = openPopAt([h.lat, h.lon], `<b style="color:#31c9ff">📤 ДОПОЛНИТЕЛЬНЫЙ СБРОС — учебный сценарий</b><br>
        Объём источника: <b>${fmtNum(res.volume,0)} м³</b> (${fmtNum(p.cfg.area_m2,0)} м² × ${fmtNum(p.cfg.mean_drawdown_m,2)} м)<br>
        Пик источника: <b>${fmtNum(res.peak,3)} м³/с</b> при t=${fmtNum(p.cfg.peak_time_s/60,0)} мин · T=${fmtNum(p.cfg.duration_s/60,0)} мин<br>
        Фоновый расход Q₀: <b>${fmtNum(res.bg,2)} м³/с</b> (медиана поста 72007, 2008–2012)<br>
        Трансформация: ${res.tau.length} участков по ~${fmtNum(avgReach(p),0)} м, каскад линейных резервуаров, c=${fmtNum(p.cfg.speed_parameter_ms,0)} м/с<br>
        <span style="color:#ffb02e;font-size:10px">Расходы рассчитаны каскадной линейной моделью (учебно).
        Зона затопления не рассчитывалась.</span>`,
      { maxWidth: 300, closeButton: true }, popSideForFlow(h, line));
    RELEASE.popup = pop;
  }, 1000);

  $('alertBanner').classList.add('show');
  $('details').innerHTML = releaseDetailsHTML(h, res);
  updateChartRelease(res);
  if (REDUCED_MOTION) releaseFinalFrame();      // без прокрутки — сразу 12 ч
  else requestAnimationFrame(releaseStep);
}

function avgReach(p){
  const n = p.points.length - 1;
  return n ? (p.points[n][0] - p.points[0][0]) / n : 0;
}

function fmtReleaseBanner(res, n, frontJ, finished){
  const R = res.tau.length;
  const q6 = res.bg + res.out[n * R + R - 1];
  return `📤 УЧЕБНЫЙ СБРОС · Перовская · t+${fmtClock(n * res.dt)} · Q₆ (${fmtNum(RELEASE.points[R][0]/1000,0)} км) = <b>${fmtNum(q6,3)} м³/с</b>` +
    (frontJ >= 0 ? ` · волна дошла до участка ${frontJ + 1}` : ' · волна у источника') +
    (finished ? ' · <b>сценарий завершён (' + fmtClock(res.horizon) + ')</b>' : '');
}

/* Раскладка по участкам для кадра n: переиспользуется step-ом и финалом.
   Покадровая перерисовка здесь и была источником «жутких лагов»: кадры
   приходят с частотой экрана (60 Гц), а смысл имеет только шаг расчётной
   сетки (dt=30 с на 30-секундную анимацию = 180 разных состояний). Отсюда —
   два фильтра: не перерисовывать тот же шаг и не трогать DOM подсказок
   чаще ~4 Гц (setTooltipContent заставляет Leaflet заново померить и
   переставить 6 постоянных тултипов — самая дорогая операция кадра). */
const RELEASE_TIP_MS = 250;
function paintReleaseFrame(n, force){
  const p = RELEASE, res = S.release.res, R = res.tau.length;
  const st = S.release;
  if (!Array.isArray(p.reachMarkers) || p.reachMarkers.length < R) return;
  const now = performance.now();
  const sameStep = n === st.lastN && !force;
  if (sameStep) return;
  st.lastN = n;
  const withTips = force || now - (st.lastTips || 0) >= RELEASE_TIP_MS;
  if (withTips) st.lastTips = now;
  let frontJ = -1;
  for (let j = 0; j < R; j++){
    const extra = res.out[n * R + j];
    const tot = res.bg + extra;
    const rel = Math.min(1, extra / res.peak);
    const mk = p.reachMarkers[j];
    mk.setStyle({ fillColor: rel > 0.5 ? '#ff3b3b' : rel > 0.2 ? '#ff8a3d' : rel > 0.02 ? '#ffb02e' : '#1a4a6b' });
    if (withTips){
      mk.setTooltipContent(`участок ${j+1} · ${fmtNum(p.points[j+1][0],0)} м<br><b>${fmtNum(tot,3)} м³/с</b>` +
        (extra > 0.001 ? ` <span style="color:#ffb02e">(+${fmtNum(extra,3)})</span>` : ''));
    }
    if (extra > 0.005) frontJ = j;
  }
  if (withTips) $('alertBanner').innerHTML = fmtReleaseBanner(res, n, frontJ, n >= res.steps);
}

function releaseFinalFrame(){
  if (!S.release) return;
  paintReleaseFrame(S.release.res.steps, true);   // force: финальный кадр обязателен
}

function releaseStep(tNow){
  if (!S.release) return;
  const res = S.release.res;
  /* горизонт пересчитываем из wall-clock, а не «+1 шаг на кадр»: тогда
     лаги кадров не уводят сценарий вперёд/назад и последние кадры не теряются */
  const frac = Math.min(1, (tNow - S.release.start) / S.release.dur);
  const n = Math.min(res.steps, Math.round(frac * res.steps));
  paintReleaseFrame(n);
  if (n < res.steps) requestAnimationFrame(releaseStep);
  else if (S.release) releaseFinalFrame();
}

function stopRelease(){
  S.release = null;
  clear(layerFlood); clear(layerFloodZone);
  /* поповер не слой в нашей группе — clear() его не снимает, иначе окно
     «учебного сброса» висело на карте и после выключения сценария */
  if (RELEASE.popup){
    try { map.closePopup(RELEASE.popup); } catch(e){}
    RELEASE.popup = null;
  }
  $('alertBanner').classList.remove('show');
  if (RELEASE.reachMarkers) RELEASE.reachMarkers = null;
  /* панель деталей после сценария оставалась «сбросовой» — возвращаем паспорт */
  if (S.selected){
    const h = HPPS.find(x => x.id === S.selected);
    if (h) $('details').innerHTML = detailsHTML(h);
    updateChart();
  }
}

function releaseDetailsHTML(h, res){
  const p = RELEASE, c = p.cfg;
  const bal = res && res.balance;
  const balLine = bal
    ? `<div class="kv"><span>Баланс воды</span><span style="color:${bal.ok?'#3ddc84':'#ff6b6b'}">${bal.ok?'✓ сходится':'⚠ расходится'} · ${fmtNum(bal.remaining,1)} м³ в резервуарах</span></div>`
    : '';
  return `<h3>${h.name}</h3>
  <div style="font-size:11px;margin-bottom:6px;color:#31c9ff">📤 Учебный сценарий дополнительного сброса</div>
  <div class="kv"><span>Модель</span><span>каскад линейных резервуаров</span></div>
  <div class="kv"><span>Источник</span><span>треугольный гидрограф</span></div>
  <div class="kv"><span>Объём V_b</span><span>${fmtNum(res.volume,0)} м³</span></div>
  <div class="kv"><span>Пик q_b,max</span><span>${fmtNum(res.peak,3)} м³/с (t=${fmtNum(c.peak_time_s/60,0)} мин)</span></div>
  <div class="kv"><span>Фон Q₀</span><span>${fmtNum(res.bg,2)} м³/с</span></div>
  <div class="kv"><span>Шаг / горизонт</span><span>${fmtNum(c.dt_s,0)} с / ${fmtClock(c.horizon_s)}</span></div>
  <div class="kv"><span>Участки</span><span>${res.tau.length} × ~${fmtNum(avgReach(p),0)} м, до ${fmtNum(p.points[p.points.length-1][0]/1000,1)} км</span></div>
  <div class="kv"><span>Скорость c</span><span>${fmtNum(c.speed_parameter_ms,0)} м/с</span></div>
  ${balLine}
  <div class="kv"><span>Сценарий</span><span style="font-size:10px">area${c.area_m2}_drawdown${String(c.mean_drawdown_m).replace('0.','').padEnd(3,'0')}</span></div>
  <div style="margin-top:8px;padding:8px 10px;background:rgba(49,201,255,.08);border:1px solid rgba(49,201,255,.25);border-radius:8px;font-size:11px;line-height:1.5">
    Реализовано по «Перовка_ИТОГ_расчёт_и_пояснения.xlsx»:
    Sᵢⁿ⁺¹ = (Sᵢⁿ + IᵢΔt)/(1+Δt/τᵢ), Oᵢ = Sᵢ/τᵢ, τᵢ=Lᵢ/c.
    Ряды сверяются автотестом с «Перовка_финальный_алгоритм.js» (npm test).
    Подписи у точек маршрута показывают полный расход Qᵢ=Q₀+Oᵢ.
    <div style="color:#ffb02e;margin-top:4px">Не инженерный прогноз прорыва; зона затопления не строилась.</div>
  </div>`;
}

function updateChartRelease(res){
  if (!S.chartPower) return;
  const R = res.tau.length;
  const step = 10;                       // каждые 5 мин
  const labels = [], colors = ['#31c9ff','#3ddc84','#ffb02e','#ff8a3d','#ff5a5a','#ff3b3b'];
  const ds = [];
  for (let n = 0; n <= res.steps; n += step){
    const t = n * res.dt;
    labels.push(Math.floor(t/60) + 'м');
  }
  for (let j = 0; j < R; j++){
    const data = [];
    for (let n = 0; n <= res.steps; n += step) data.push(+(res.bg + res.out[n * R + j]).toFixed(4));
    ds.push({ label: `Q${j+1} (${RELEASE.points[j+1][0]} м), м³/с`, data,
      borderColor: colors[j], borderWidth: j === R-1 ? 2.2 : 1.2, tension: .25, fill: false, pointRadius: 0 });
  }
  const cp = S.chartPower;
  cp.data.labels = labels;
  cp.data.datasets = ds;
  cp.options.scales.y.title.text = 'Расход, м³/с';
  /* 6 серий разного цвета без легенды читаться не будут — включаем только
     здесь, в обычном режиме на графике одна линия и легенда не нужна */
  cp.options.plugins.legend.display = true;
  cp.options.plugins.legend.labels = { color:'#dbe6f2', boxWidth:9, boxHeight:9, font:{size:9} };
  cp.options.scales.y.ticks.callback = v => fmtNum(+v, 2);
  cp.options.scales.x.ticks = Object.assign({}, cp.options.scales.x.ticks, { color:'#8ba0b6', font:{size:8} });
  cp.options.scales.x.display = true;
  cp.options.plugins.tooltip.callbacks = { label: ctx => ` ${ctx.dataset.label.split(',')[0]}: ${fmtNum(ctx.parsed.y,4)} м³/с` };
  cp.update('none');
  /* нижний график освобождается: уровень при сбросе не моделируется */
  S.chartLevel.data.labels = [];
  S.chartLevel.data.datasets = [];
  const lbl = $('chartLabelLevel');
  if (lbl) lbl.textContent = 'уровень ВБ в учебном сценарии сброса не рассчитывается';
  S.chartLevel.update('none');
}

/* ============================================================
   ВОДОХРАНИЛИЩЕ
   ============================================================ */
async function loadReservoirOSM(h){
  const key = RES_KEY_PREFIX + h.id;
  try {
    const raw = localStorage.getItem(key);
    if (raw){
      const c = JSON.parse(raw);
      if (Date.now()-c.ts < 30*24*3600*1000 && Array.isArray(c.polygons)){
        return c.polygons;
      }
    }
  } catch(e){}

  try {
    const RADIUS = 45000;
    const query = `[out:json][timeout:25];
(
  way(around:${RADIUS},${h.lat},${h.lon})["natural"="water"];
  relation(around:${RADIUS},${h.lat},${h.lon})["natural"="water"];
  way(around:${RADIUS},${h.lat},${h.lon})["water"~"reservoir|lake"];
  relation(around:${RADIUS},${h.lat},${h.lon})["water"~"reservoir|lake"];
  way(around:${RADIUS},${h.lat},${h.lon})["waterway"="riverbank"];
);
out geom;`;

    const data = await overpassQuery(query, 18000);

    const upRad = ((h.flowDir || 180) + 180) * Math.PI / 180;
    const upLat = Math.cos(upRad), upLon = Math.sin(upRad);
    const cosLat = Math.cos(h.lat * Math.PI / 180);
    const nameRoot = (h.reservoirName || '').toLowerCase().slice(0, 6);

    const candidates = [];

    for (const el of (data.elements || [])){
      const parts = [];
      if (el.type === 'way' && el.geometry && el.geometry.length >= 4){
        parts.push(el.geometry.map(p => [p.lat, p.lon]));
      } else if (el.type === 'relation' && el.members){
        for (const m of el.members){
          if (m.role !== 'inner' && m.geometry && m.geometry.length >= 4){
            parts.push(m.geometry.map(p => [p.lat, p.lon]));
          }
        }
      }
      if (!parts.length) continue;

      let maxDownstream = 0;
      let perim = 0, cLat = 0, cLon = 0, n = 0;

      for (const pts of parts){
        for (let i = 0; i < pts.length; i++){
          const a = pts[i], b = pts[(i+1) % pts.length];
          perim += haversineM(a[0],a[1],b[0],b[1]);
        }
        for (const p of pts){
          const dLat = p[0] - h.lat;
          const dLon = (p[1] - h.lon) * cosLat;
          const dotUp = dLat * upLat + dLon * upLon;
          if (-dotUp > maxDownstream) maxDownstream = -dotUp;
          cLat += p[0]; cLon += p[1]; n++;
        }
      }
      if (!n) continue;
      cLat /= n; cLon /= n;

      if (maxDownstream > 5000) continue;
      if (perim < 1500) continue;

      const dist = haversineM(h.lat, h.lon, cLat, cLon);
      if (dist > RADIUS) continue;

      const dLat = cLat - h.lat;
      const dLon = (cLon - h.lon) * cosLat;
      const dotUp = dLat * upLat + dLon * upLon;
      if (dotUp < 0) continue;

      const nm = (el.tags?.name || '').toLowerCase();
      let nameMatch = 0;
      if (nameRoot && nm.includes(nameRoot)) nameMatch = 1;

      candidates.push({ parts, perim, dist, nameMatch });
    }

    candidates.sort((a,b) => {
      if (a.nameMatch !== b.nameMatch) return b.nameMatch - a.nameMatch;
      return b.perim - a.perim;
    });

    const result = candidates.slice(0, 6).map(c => c.parts);
    try { localStorage.setItem(key, JSON.stringify({ ts:Date.now(), polygons:result })); } catch(e){}
    console.log(`Водохранилище ${h.name} — ${result.length} объектов из ${candidates.length}`);
    return result;

  } catch(e){
    console.warn(`Водохранилище ${h.name} — ошибка: ${e.message}`);
    try { localStorage.setItem(key, JSON.stringify({ ts:Date.now(), polygons:[] })); } catch(e){}
    return [];
  }
}

/* ============================================================
   СИНТЕТИКА И OPEN-METEO
   ============================================================ */
/* Генератор ряда лежит в model.js (syntheticData) — там календарь идёт по
   UTC-миллисекундям. Прежняя локальная версия на переходе через летнее
   время выдавала дубль дня и пропуск следующего (в Europe/Berlin — 4 и 4
   за период с 2023 г.), из-за чего офлайн-ряд расходился с рядом
   Open-Meteo (timezone=UTC) на сутки. */
const syntheticData = (h, mode) => gesSynthetic(h, mode, { start: HISTORY_START, now: Date.now() });

/* ============================================================
   Open-Meteo: один запрос на весь список станций
   API принимает координаты через запятую и отдаёт массив результатов,
   поэтому 6 станций × 2 сервиса = 12 запросов на режим сворачиваются
   в 2: быстрее первый кадр и нет риска упереться в 429.
   ============================================================ */
function openMeteoUrls(mode, lats, lons){
  if (mode === 'history'){
    const range = `&start_date=${HISTORY_START}&end_date=${todayISO(8)}`;
    return [
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=temperature_2m_mean,precipitation_sum&timezone=UTC${range}`,
      `https://flood-api.open-meteo.com/v1/flood?latitude=${lats}&longitude=${lons}&daily=river_discharge&timezone=UTC${range}`
    ];
  }
  const range = '&past_days=30&forecast_days=16';
  return [
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=temperature_2m_mean,precipitation_sum${range}&timezone=UTC`,
    `https://flood-api.open-meteo.com/v1/flood?latitude=${lats}&longitude=${lons}&daily=river_discharge${range}&timezone=UTC`
  ];
}

/* Кое-какая провенанс-информация из ответа: какая ячейка сетки 0.1° реально
   использована и на какой модели — для малых ГТС это важно показывать. */
function apiMeta(root){
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  const m = {};
  for (const k of ['latitude','longitude','elevation','model','grid_code','timezone','generationtime_ms'])
    if (root[k] != null) m[k] = root[k];
  return Object.keys(m).length ? m : null;
}
function nthPayload(raw, i){
  const r = Array.isArray(raw) ? (raw[i] || null) : (i ? null : raw);
  return r && r.daily ? r : null;
}
function assembleData(rawClim, rawHydro){
  return {
    hydro: { time: rawHydro.daily.time, q: rawHydro.daily.river_discharge },
    clim:  { time: rawClim.daily.time,  t: rawClim.daily.temperature_2m_mean, p: rawClim.daily.precipitation_sum },
    meta:  apiMeta(rawHydro)
  };
}

/* → { [id]: data } для тех станций, по которым оба сервиса ответили. */
async function fetchFromAPIBatch(mode, list){
  const stations = list && list.length ? list : HPPS;
  const lats = stations.map(h => h.lat).join(',');
  const lons = stations.map(h => h.lon).join(',');
  const [rawClim, rawHydro] = await Promise.all(openMeteoUrls(mode, lats, lons).map(u => fetchWithRetry(u, 15000, 3)));
  const out = {};
  stations.forEach((h, i) => {
    const c = nthPayload(rawClim, i), f = nthPayload(rawHydro, i);
    if (c && f) out[h.id] = assembleData(c, f);
  });
  if (!Object.keys(out).length) throw new Error('Open-Meteo вернул пустой ответ');
  return out;
}

async function fetchFromAPI(h, mode){
  if (mode === 'climate'){
    /* Климатический режим — ТОЛЬКО файл пользователя «модель клим.xlsx»
       (climate-data.js): CMIP6 ens-mean SSP5-8.5, осадки мм/день помесячно,
       история 1985–2025 + будущее 2041–2070. Внешние климатические API
       не вызываются. */
    const cd = (typeof CLIMATE_DATA !== 'undefined') ? CLIMATE_DATA[h.id] : null;
    if (!cd || !cd.hist || !cd.hist.length) throw new Error('нет климатической модели для станции');
    const time = [], p = [], t = [];
    const rows = cd.hist.concat(cd.fut || []);
    for (const row of rows){
      const y = row[0];
      for (let m = 0; m < 12; m++){
        const v = row[m+1];
        if (v == null) continue;
        time.push(`${y}-${String(m+1).padStart(2,'0')}-15`);
        p.push(v * daysInMonth(y, m+1));   // мм/день → мм/мес (календарь UTC, model.js)
        t.push(null);
      }
    }
    const QmaxT = Math.max(h.capacityMW, 0.05) * 1e6 / (1000*9.81*h.head*h.eff);
    const Qmean = Math.max(0.02, 0.4*QmaxT);
    const valid = p.filter(v => v != null && v > 0);
    const Pmean = valid.length ? valid.reduce((s,v)=>s+v,0)/valid.length : 50;
    const q = p.map(P => Math.max(0, Qmean*(0.4 + 0.8*(P||0)/Math.max(0.1,Pmean))));
    /* Месячный ряд: точка данных — середина месяца (15-е). Из-за другой
       сетки дат он не совпадает с суточным рядом по индексу — поэтому
       все ряды сводятся по дате (GES.alignIndex), а не по номеру. */
    return { hydro:{time, q}, clim:{time, t, p},
             meta: { model:'CMIP6 ens-mean SSP5-8.5', grid_code:'месяц, 15-е число', timezone:'UTC' } };
  }
  /* история/прогноз — тот же пакетный запрос, но для одной станции
     (используется selectHPP для станций вне очереди докачки) */
  const batch = await fetchFromAPIBatch(mode, [h]);
  if (!batch[h.id]) throw new Error('Open-Meteo не вернул ряд по станции');
  return batch[h.id];
}

async function loadStation(h, mode){
  /* Климатический режим — встроенные данные (climate-data.js), сеть не нужна */
  if (mode === 'climate'){
    try {
      const data = await fetchFromAPI(h, mode);
      return { data, source: 'api' };
    } catch(e){
      console.warn(`Климат ${h.name}: ${e.message}`);
      return { data: syntheticData(h, mode), source: 'synth' };
    }
  }
  if (apiAvailable === false){
    return { data: syntheticData(h, mode), source: 'synth' };
  }
  try {
    const data = await fetchFromAPI(h, mode);
    setCached(mode, h.id, data);
    return { data, source: 'api' };
  } catch(e){
    lastApiError = e.message || String(e);
    const stale = getStaleCached(mode, h.id);
    if (stale) return { data: stale, source: 'cache' };
    console.warn(`Станция ${h.name}: ${e.message}`);
    return { data: syntheticData(h, mode), source: 'synth' };
  }
}

/* ============================================================
   ПЕРЕСЧЁТ ПОД СЦЕНАРИЙ
   Модель ряда — в model.js (simulate), здесь только связка с состоянием.
   ============================================================ */
function recompute(){
  HPPS.forEach(h => {
    const c = S.cache[S.mode]?.[h.id];
    if (!c){ delete S.results[h.id]; S.timeLen[h.id] = 0; return; }

    /* Сценарные множители зависят от КАЛЕНДАРНОЙ ДАТЫ ряда, а не от S.idx:
       старый вариант с гауссианой вокруг позиции бегунка «замораживал» пик
       паводка там, где сценарий включили, и уводил его при перемотке. */
    let q = c.hydro.q;
    if (S.scenario === 'flood' || S.scenario === 'drought'){
      const times = c.hydro.time;
      q = q.map((v, k) => (v || 0) * scenarioFactor(h, times[k], S.scenario));
    }

    const r = setStationSeries(h, null, { hydro: { time: c.hydro.time, q }, clim: c.clim }, null);

    /* Зеркало воды. В «паводке»/«засухе» отметка и площадь пересчитываются
       схемой свободным водосбросом; в «норме» (и в режиме климата, где ряд
       месячный и пруд уходит к УМО на всю весну) берег следует ФАКТИЧЕСКОЙ
       отметке ряда — иначе зеркало висит снимком при НПВ и меняется только
       цвет. Без поправки пруд не менялся бы вовсе: правило эксплуатации в
       simulate держит уровень на целевой отметке, а излишек паводка уходит
       в холостой сброс. applyReservoirScenario возвращает КОПИЮ. */
    if (S.scenario === 'flood' || S.scenario === 'drought' || S.scenario === 'normal'){
      S.results[h.id] = applyReservoirScenario(r, h, c.hydro.time, S.scenario);
    }

    if (S.scenario === 'dam_break' && S.selected === h.id){
      /* копия, а не правка на месте — иначе обнулённые ряды оставались
         «мёртвыми» и после выключения сценария, пока их кто-то не
         пересчитает */
      S.results[h.id] = damBreakView(S.results[h.id]);
    }
  });
}

/* ============================================================
   МАРКЕРЫ
   ============================================================ */
function createMarker(h){
  const mk = L.circleMarker([h.lat, h.lon], {
    radius: 8, color:'#ffffff', weight: 2.5,
    fillColor:'#888', fillOpacity: 1, opacity: 1,
    keyboard: true,                    // Leaflet даёт метке tabindex — доступна с клавиатуры
    title: h.name
  }).addTo(layerMarkers);
  mk.on('click', () => selectHPP(h.id, false));
  mk.bindTooltip(h.name, { direction:'top', offset:[0,-8] });
  /* Функция вместо строки: Leaflet вызовет её в момент открытия попапа.
     Раньше HTML шести станций пересобирался на КАЖДЫЙ кадр анимации. */
  mk.bindPopup(() => popupFor(h), { maxWidth: 330 });
  S.markers[h.id] = mk;
  return mk;
}

function popupFor(h){
  const i = ki(h);
  const r = S.results[h.id];
  if (!r || i < 0) return `<h4>${h.name}</h4><p style="margin:0;color:var(--dim)">нет данных</p>`;
  return popupHTML(h, r, i, markerColor(h, r, i));
}

/* ============================================================
   ТАЙМЛАЙН
   ============================================================ */
function updateTimeline(mode, keepIdx){
  const sl = $('slider');
  const n = S.dates.length;
  sl.max = Math.max(0, n - 1);
  if (!keepIdx) S.idx = Math.floor(n / 2);
  S.idx = Math.max(0, Math.min(S.idx, Math.max(0, n - 1)));
  sl.value = S.idx;
  const fmt = d => mode === 'history' ? String(d).slice(0,4) : String(d).slice(0,7);
  if (!n){ $('tickA').textContent = $('tickB').textContent = $('tickC').textContent = '—'; return; }
  $('tickA').textContent = fmt(S.dates[0]);
  $('tickB').textContent = fmt(S.dates[Math.floor(n/2)]);
  $('tickC').textContent = fmt(S.dates[n-1]);
}

/* Единая календарная ось: самый длинный ряд из загруженных станций.
   Осмысленный выбор, а не «кто первый успел»: при смешении кэша,
   API и синтетики длины рядов различаются. */
function syncAxis(mode, keepIdx){
  let best = null;
  for (const h of HPPS){
    const c = S.cache[mode]?.[h.id];
    const t = c && c.hydro ? c.hydro.time : null;
    if (t && t.length && (!best || t.length > best.length)) best = t;
  }
  if (!best) return false;
  const changed = best !== S.dates;
  S.dates = best;
  updateTimeline(mode, keepIdx || !changed);
  return true;
}

/* ============================================================
   ЗАГРУЗКА ПЕРИОДА
   ============================================================ */
async function loadPeriod(mode){
  if (S.loading) return;
  S.loading = true;
  try {
    await loadPeriodInner(mode);
  } catch(e){
    console.error('loadPeriod:', e);
    setStatus(`<span class="err">ошибка загрузки: ${e.message}</span>`);
  } finally {
    S.loading = false;      // раньше флаг оставался поднятым при исключении,
  }                         // и переключение режимов молча переставало работать
}

function hppRow(id){ return document.querySelector(`.hppItem[data-id="${id}"]`); }
function hppRowSet(id, srcCls, mw){
  const item = hppRow(id);
  if (!item) return;
  const dot = item.querySelector('.src');
  if (dot) dot.className = 'src ' + srcCls;
  if (mw !== undefined) item.querySelector('.mw').textContent = mw;
}

async function loadPeriodInner(mode){
  S.results = {}; S.idx = 0; S.playing = false; S.damBreak = null; S.dates = [];
  S.cache[mode] = {}; S.sources = {}; S.loadingStation = {};
  S.timeIdx = {}; S.timeLen = {};

  clear(layerFlood);
  clear(layerRes);
  S.reservoirs = {};
  $('playBtn').textContent = '▶';

  HPPS.forEach(h => hppRowSet(h.id, 'loading', '…'));
  setStatus(`<span class="warn">загрузка</span> · ${mode}`);

  /* 1. Мгновенно показываем всё, что есть в кэше */
  let fromCache = 0;
  HPPS.forEach(h => {
    const cached = getCached(mode, h.id);
    if (!cached) return;
    setStationSeries(h, mode, cached, 'cache');
    fromCache++;
    hppRowSet(h.id, 'cache', capLabel(h));
  });
  if (fromCache){ syncAxis(mode); recompute(); render(); }

  if (apiAvailable !== true) await pingAPI();

  const missing = HPPS.filter(h => !S.cache[mode][h.id]);
  missing.sort((a,b) => {
    const ai = PRIORITY.indexOf(a.id), bi = PRIORITY.indexOf(b.id);
    return (ai<0?999:ai) - (bi<0?999:bi);
  });

  if (!apiAvailable && !missing.length){
    setStatus(`<b>${mode}</b> · <span class="warn">🟡 ${fromCache} из кэша (офлайн)</span>`);
    return;
  }

  /* 2. Фоновая ревалидация: кэш показываем сразу, но если он старше
        порога — молча докачиваем свежие данные. */
  const REVALIDATE_MS = { history: 3600e3, forecast: 10*60e3, climate: 24*3600e3 };
  const now = Date.now();
  const stale = apiAvailable ? HPPS.filter(h => {
    if (!S.cache[mode][h.id]) return false;
    const ts = getCacheEntryTS(mode, h.id);
    return ts && (now - ts > REVALIDATE_MS[mode]);
  }) : [];

  const queue = [...missing, ...stale];
  let countApi = 0, countSynth = 0;

  if (queue.length && apiAvailable && mode !== 'climate'){
    /* 3. Один пакетный запрос на все станции очереди (было 2 на каждую) */
    try {
      const batch = await fetchFromAPIBatch(mode, queue);
      for (const h of queue){
        const data = batch[h.id];
        if (!data) continue;
        setCached(mode, h.id, data);
        setStationSeries(h, mode, data, 'api');
        hppRowSet(h.id, 'api', capLabel(h));
        countApi++;
      }
      syncAxis(mode, true);
      recompute(); render();
    } catch(e){
      lastApiError = e.message || String(e);
      console.warn('Пакетный запрос Open-Meteo не удался, перехожу на поштучный:', e.message);
    }
  }

  /* 4. Что пакет не закрыл — докачиваем по одной станции (3 параллельно) */
  const rest = queue.filter(h => S.sources[h.id] !== 'api');
  const total = rest.length;
  let done = 0;

  async function worker(){
    while (rest.length){
      const h = rest.shift();
      if (S.loadingStation[h.id]) continue;
      S.loadingStation[h.id] = true;
      const { data, source } = await loadStation(h, mode);
      setStationSeries(h, mode, data, source);
      delete S.loadingStation[h.id];

      if (source === 'api') countApi++;
      else countSynth++;
      hppRowSet(h.id, source, capLabel(h));

      syncAxis(mode, true);
      recompute(); render();

      done++;
      setStatus(`<span class="warn">докачка</span> · ${done}/${total}`);
      await sleep(120);
    }
  }
  if (total) await Promise.all([worker(), worker(), worker()]);

  const parts = [];
  if (fromCache) parts.push(`<span class="warn">🟡 ${fromCache} из кэша</span>`);
  if (countApi)  parts.push(`<span class="ok">🟢 ${countApi} онлайн</span>`);
  if (countSynth){
    parts.push(`<span class="err">🔴 ${countSynth} офлайн</span>`);
    if (!countApi && !fromCache){
      parts.push(`<span class="err">API недоступно${lastApiError ? ': '+lastApiError : ''}</span>`);
      parts.push(`<span class="warn">повторная проверка каждые 30 с · или нажмите ⟳</span>`);
    }
  }
  setStatus(`<b>${mode}</b> · ${parts.join(' · ') || 'нет данных'}`);
}

/* ============================================================
   ПАРАМЕТРЫ ВОЛНЫ (с учётом WAVE_SCALE)
   ============================================================ */
function getWaveParams(h){
  const a = h.terrainAmpl || 100;
  let base;
  if (a > 300){
    base = { type:'горная', maxDist:60000, maxWidth:4200, speedMs:15,
             baseDuration:8, ringCount:4, description:'Узкая быстрая волна вдоль ущелья' };
  } else if (a > 150){
    base = { type:'предгорная', maxDist:80000, maxWidth:8000, speedMs:8,
             baseDuration:10, ringCount:4, description:'Волна средней ширины' };
  } else {
    base = { type:'равнинная', maxDist:120000, maxWidth:15000, speedMs:3,
             baseDuration:12, ringCount:5, description:'Широкая медленная волна по пойме' };
  }
  base.maxDist  = Math.round(base.maxDist  * WAVE_SCALE);
  base.maxWidth = Math.round(base.maxWidth * WAVE_SCALE);
  if (a < 150) base.maxWidth = Math.min(base.maxWidth, 260);   // малые ГЭС: волна не шире ~260 м
  return base;
}

/* Профиль ширин лежит на сетке расчёта (ds≈250 м), а ленту рисовать по этой
   сетке нельзя: на шаге в 250 м излучины ручья спрямляются, и лента идёт
   через поля (так и выглядело «на Роккаланмяки»). Поэтому геометрию ленты
   даёт исходное русло, а ряд ширин к нему протягивается по дуговой
   координате. */
function widthsAlong(cum, widthsCell, ds){
  const out = new Float32Array(cum.length);
  const last = widthsCell.length - 1;
  for (let j = 0; j < cum.length; j++){
    const s = cum[j] / ds;
    const k = Math.max(0, Math.min(last, Math.floor(s)));
    const t = Math.max(0, Math.min(1, s - k));
    const wa = widthsCell[k] || 0, wb = widthsCell[Math.min(last, k+1)] || 0;
    out[j] = wa + (wb - wa) * t;
  }
  return out;
}

/* Chaikin без разрыва с рядом ширин: он ставит новые точки на 1/4 и 3/4
   отрезка — там же интерполируется и ширина. Прежний вариант «сгладить
   линию, а ширины брать по номеру точки» сжимал профиль ширин вчетверо,
   и вся лента получалась равномерной. */
function chaikinWithWidths(pts, widths, iterations){
  let p = pts, w = Array.prototype.slice.call(widths);
  for (let it = 0; it < (iterations || 1) && p.length > 2; it++){
    const np = [p[0]], nw = [w[0]];
    for (let i = 0; i < p.length - 1; i++){
      const A = p[i], B = p[i+1], wa = w[i], wb = w[i+1];
      np.push([0.75*A[0] + 0.25*B[0], 0.75*A[1] + 0.25*B[1]]); nw.push(wa + (wb - wa)*0.25);
      np.push([0.25*A[0] + 0.75*B[0], 0.25*A[1] + 0.75*B[1]]); nw.push(wa + (wb - wa)*0.75);
    }
    np.push(p[p.length-1]); nw.push(w[w.length-1]);
    p = np; w = nw;
  }
  return { pts: p, widths: w };
}

/* Радиус описанной окружности трёх соседних точек, метры; 0 — если точки
   почти на одной линии. Нужен, чтобы полуширина не превышала кривизну:
   смещение дальше радиуса складывает ленту «бабочкой» и рисует её поперёк
   излучины вместо того, чтобы идти по ней. */
function curvRadiusM(a, b, c, degLat, degLon){
  const ax = a[1]/degLon, ay = a[0]/degLat, bx = b[1]/degLon, by = b[0]/degLat,
        cx = c[1]/degLon, cy = c[0]/degLat;
  const A = Math.hypot(bx-cx, by-cy), B = Math.hypot(cx-ax, cy-ay), C = Math.hypot(bx-ax, by-ay);
  const cross = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
  const area = Math.abs(cross) / 2;
  if (area < 1e-6 || A*B*C <= 0) return 0;
  return (A*B*C) / (4*area);
}

/* Лента заданной ширины вдоль ломаной. widths — ПО ТОЧКАМ centerline
   (1:1), сглаживание и смещение считаются вместе с ними. */
function makeBandPolygon(centerline, widths, latRef, smoothIters){
  const R = 6371000;
  const latR = latRef*Math.PI/180;
  const degLat = 180/(Math.PI*R);
  const degLon = 180/(Math.PI*R*Math.cos(latR));
  if (!centerline || centerline.length < 2) return [];

  const ch = chaikinWithWidths(centerline, widths, smoothIters == null ? 2 : smoothIters);
  const pts = ch.pts, w = ch.widths, n = pts.length;

  /* сглаживание центра нужно только очень широким лентам (окно ≈ 45%
     ширины): на узкой ленте ручья то же окно съедало меандры */
  let segSum = 0;
  for (let i = 1; i < n; i++){
    segSum += Math.hypot((pts[i][0]-pts[i-1][0])/degLat, (pts[i][1]-pts[i-1][1])/degLon);
  }
  const segAvg = Math.max(1, segSum/Math.max(1, n-1));
  let maxW = 1;
  for (let i = 0; i < n; i++) maxW = Math.max(maxW, w[i] || 0);
  const locW = w[Math.floor(n/2)] || maxW;
  const winPts = Math.round((locW * 0.45) / segAvg);
  let sm = pts;
  if (winPts >= 3){
    const half = Math.floor(winPts/2);
    sm = new Array(n);
    for (let i = 0; i < n; i++){
      const a = Math.max(0, i-half), b = Math.min(n-1, i+half);
      let la = 0, lo = 0;
      for (let j = a; j <= b; j++){ la += pts[j][0]; lo += pts[j][1]; }
      const c = b - a + 1;
      sm[i] = [la/c, lo/c];
    }
  }

  const left = [], right = [];
  for (let i = 0; i < n; i++){
    let dLat, dLon;
    if (i === 0){ dLat = sm[1][0]-sm[0][0]; dLon = sm[1][1]-sm[0][1]; }
    else if (i === n-1){ dLat = sm[i][0]-sm[i-1][0]; dLon = sm[i][1]-sm[i-1][1]; }
    else { dLat = sm[i+1][0]-sm[i-1][0]; dLon = sm[i+1][1]-sm[i-1][1]; }
    const dxM = dLon/degLon, dyM = dLat/degLat;
    const lenM = Math.hypot(dxM, dyM) || 1;
    const nxM = -dyM/lenM, nyM = dxM/lenM;

    let halfW = Math.max(6, (w[i] != null ? w[i] : w[w.length-1]) / 2);
    if (i > 0 && i < n-1){
      const rr = curvRadiusM(sm[i-1], sm[i], sm[i+1], degLat, degLon);
      if (rr > 0) halfW = Math.min(halfW, 0.85 * rr);
    }
    const offLat = nyM*halfW*degLat;
    const offLon = nxM*halfW*degLon;
    left.push([sm[i][0]+offLat, sm[i][1]+offLon]);
    right.push([sm[i][0]-offLat, sm[i][1]-offLon]);
  }
  return [...left, ...right.reverse()];
}

/* Сглаживание ломаной (Чайкина) — срезает острые углы центральной линии
   перед построением ленты, дополнительно снижая риск самопересечения
   и убирая "зубчатый" вид у синтетического запасного русла. */
function chaikinSmooth(course, iterations=1){
  let pts = course;
  for (let it=0; it<iterations && pts.length>2; it++){
    const out = [pts[0]];
    for (let i=0;i<pts.length-1;i++){
      const p0=pts[i], p1=pts[i+1];
      out.push([0.75*p0[0]+0.25*p1[0], 0.75*p0[1]+0.25*p1[1]]);
      out.push([0.25*p0[0]+0.75*p1[0], 0.25*p0[1]+0.75*p1[1]]);
    }
    out.push(pts[pts.length-1]);
    pts = out;
  }
  return pts;
}
function smoothRing(ring, iterations=1){
  if (!ring || ring.length < 4) return ring;
  const closed = ring[0][0]===ring[ring.length-1][0] && ring[0][1]===ring[ring.length-1][1];
  const base = closed ? ring.slice(0,-1) : ring;
  let out = base;
  for (let it=0; it<iterations; it++){
    const n = out.length;
    const res = [];
    for (let i=0;i<n;i++){
      const p0=out[i], p1=out[(i+1)%n], pm=out[(i-1+n)%n];
      res.push([0.5*pm[0]+0.5*p0[0], 0.5*pm[1]+0.5*p0[1]]);
      res.push([0.5*p0[0]+0.5*p1[0], 0.5*p0[1]+0.5*p1[1]]);
    }
    out = res;
  }
  if (closed) out.push(out[0]);
  return out;
}

function makeFloodWaveFromCourse(h, course, progress){
  /* progress 0..1. Фронт движется вдоль реки с ПОСТОЯННОЙ скоростью (без
     искусственных степенных искажений времени). Форма волны — как у реальной
     волны прорыва: максимальная ширина у плотины (там продолжается истечение),
     плавное сужение к фронту и острый «нос» у переднего края. В первые 10%
     времени волна разгоняется (ramp), в последние ~22% — затухает (decay):
     и ширина, и прозрачность спадают, вместо резкого исчезновения. */
  if (progress <= 0.001) return null;
  const params = getWaveParams(h);
  const totalLen = courseLength(course);
  const ramp  = Math.min(1, progress / 0.1);
  const decay = progress > 0.78 ? Math.max(0, 1 - (progress - 0.78) / 0.22) : 1;
  const frontLen = totalLen * Math.min(1, progress);
  if (frontLen < 250) return null;
  const trimmed = trimCourse(course, frontLen);
  if (trimmed.length < 2) return null;
  const n = trimmed.length;
  const W = Math.min(params.maxWidth, 300) * ramp * (0.45 + 0.55 * decay);
  const widths = trimmed.map((_, i) => {
    const s = n > 1 ? i/(n-1) : 0;             // 0 — плотина, 1 — фронт
    const taper = 1 - 0.6 * Math.pow(s, 0.85); // затухание к переднему краю
    const snout = s > 0.88 ? 0.25 + 0.75*(1-s)/0.12 : 1; // острый нос
    const startRamp = s < 0.04 ? 0.25 + 0.75*s/0.04 : 1; // сужение у плотины (без «воротника»)
    return Math.max(10, W * taper * snout * startRamp);
  });
  const pts = makeBandPolygon(trimmed, widths, h.lat, 3);
  return { pts, params, front: trimmed[n-1], decay };
}

/* Максимальный охват затопления: лента по ВСЕЙ достижимой части русла
   без запуска/затухания — то, что волна в итоге зальёт. Рисуется один
   раз под движущейся волной бледным слоем «зона затопления». */
function makeFloodFootprint(h, course){
  const params = getWaveParams(h);
  const trimmed = course;
  const n = trimmed.length;
  if (n < 2) return null;
  const W = params.maxWidth * 1.1;
  const widths = trimmed.map((_, i) => {
    const s = n > 1 ? i/(n-1) : 0;
    const taper = 1 - 0.55 * Math.pow(s, 0.85);
    const snout = s > 0.96 ? 0.3 + 0.7*(1-s)/0.04 : 1;
    const startRamp = s < 0.04 ? 0.25 + 0.75*s/0.04 : 1;
    return Math.max(10, W * taper * snout * startRamp);
  });
  return { pts: makeBandPolygon(trimmed, widths, h.lat, 2), params };
}

/* ============================================================
   ФИЗИЧЕСКАЯ МОДЕЛЬ ПРОРЫВА ПЛОТИНЫ (1D)
   Уравнения мелкой воды вдоль реального русла:
     ∂A/∂t + ∂Q/∂x = 0
     ∂Q/∂t + ∂(Q²/A + gA²/2B̄)/∂x = −gA·dz/∂x − g·n²·Q|Q|·A/(A·R^{4/3})
   Канал — трапеция (B(s) по дну, откос m=1:18), шероховатость Мэннинга
   n=0.04 (горный галечник). Профиль дна — реальный (SRTM/DEM, встроен).
   Граничное условие на створе — водослив широкого порога с формированием
   прорана за ~20 мин и опорожнением водохранилища (баланс объёма).
   Схема Годунова с потоком Гуно (HLL), адаптивный шаг по Куранту,
   сухое дно обрабатывается корректно (переход мокрое/сухое).
   ============================================================ */
function resampleUniform(course, ds){
  /* единая сетка ds вдоль русла; заодно — кумулятивная дистанция исходного курса */
  const cum = [0];
  for (let i=1;i<course.length;i++) cum.push(cum[i-1] + haversineM(...course[i-1], ...course[i]));
  const L = cum[cum.length-1];
  const N = Math.max(10, Math.floor(L/ds));
  const line = []; let j = 0;
  for (let k=0;k<=N;k++){
    const s = k*ds;
    while (j < cum.length-2 && cum[j+1] < s) j++;
    const t = cum[j+1] > cum[j] ? (s-cum[j])/(cum[j+1]-cum[j]) : 0;
    line.push([course[j][0] + (course[j+1][0]-course[j][0])*Math.min(1,Math.max(0,t)),
               course[j][1] + (course[j+1][1]-course[j][1])*Math.min(1,Math.max(0,t))]);
  }
  return { line, cum, L, N };
}

function simulateDamBreak(h, course, elev){
  const ds = 250;
  const { line, cum, L, N } = resampleUniform(course, ds);

  /* профиль дна на единой сетке: elev привязан к исходным точкам курса */
  const z = new Float64Array(N+1);
  for (let k=0;k<=N;k++){
    const s = k*ds;
    let j = 0;
    while (j < cum.length-2 && cum[j+1] < s) j++;
    const t = cum[j+1] > cum[j] ? (s-cum[j])/(cum[j+1]-cum[j]) : 0;
    const za = elev[Math.min(j, elev.length-1)], zb = elev[Math.min(j+1, elev.length-1)];
    z[k] = za + (zb-za)*Math.min(1, Math.max(0, t));
  }
  /* лёгкое сглаживание профиля (DEM-шум в ущелье) */
  for (let pass=0; pass<4; pass++){
    for (let k=1;k<N;k++) z[k] = (z[k-1] + 2*z[k] + z[k+1]) / 4;
  }

  const g = 9.81, nM = MANNING_N, mSide = 6;   /* откосы стенок каньона 1:6 — только для показа ширины */
  const wCell = new Float64Array(N+1);          // характерная ширина русла (м)
  for (let k=0;k<=N;k++){
    const s = k*ds / Math.max(1, L);
    wCell[k] = (h.chanW0 || 40) + ((h.chanW1 || 160) - (h.chanW0 || 40)) * Math.pow(s, 0.7);
  }

  /* подпор у плотины */
  const H0eff = (h.nmu - z[0] > 3) ? (h.nmu - z[0]) : (h.damH || 10);
  let poolLvl = z[0] + H0eff;
  let poolVol = h.totalVolume * 1e9;

  const Hd = new Float64Array(N+1);              // глубина, м
  const q  = new Float64Array(N+1);              // удельный расход, м²/с
  const Hn = new Float64Array(N+1), qn = new Float64Array(N+1);
  const F1 = new Float64Array(N+2), F2 = new Float64Array(N+2);

  /* поток Гуно (HLL) на грани между ячейками, сухое дно корректно */
  const fo = [0, 0];
  const hll = (hL, zL, qL, hR, zR, qR) => {
    const zf = Math.max(zL, zR);
    const HL = Math.max(0, hL + zL - zf), HR = Math.max(0, hR + zR - zf);
    if (HL < 1e-6 && HR < 1e-6){ fo[0] = 0; fo[1] = 0; return; }
    const uL = qL / Math.max(HL, 1e-6), uR = qR / Math.max(HR, 1e-6);
    const aL = Math.sqrt(g * Math.max(HL, 0)), aR = Math.sqrt(g * Math.max(HR, 0));
    const sL = Math.min(uL - aL, uR - aR), sR = Math.max(uL + aL, uR + aR);
    const FL1 = HL * uL, FL2 = HL * uL * uL + 0.5 * g * HL * HL;
    const FR1 = HR * uR, FR2 = HR * uR * uR + 0.5 * g * HR * HR;
    if (sL >= 0){ fo[0] = FL1; fo[1] = FL2; }
    else if (sR <= 0){ fo[0] = FR1; fo[1] = FR2; }
    else {
      fo[0] = (sR*FL1 - sL*FR1 + sL*sR*(HR - HL)) / (sR - sL);
      fo[1] = (sR*FL2 - sL*FR2 + sL*sR*(HR*uR - HL*uL)) / (sR - sL);
    }
  };

  const frames = [];
  const maxW = new Float64Array(N+1);
  const T_FORM = 20*60;                          // формирование прорана, с
  const T_MAX = 48*3600;
  let t = 0, nextFrame = 0, stuck = 0;

  while (t < T_MAX){
    /* расход прорана: водослив широкого порога */
    const breach = Math.min(1, t / T_FORM);
    let Qsrc = 0;
    if (poolVol > 0 && poolLvl > z[0]){
      Qsrc = 1.7 * (h.breachW || 60) * breach * Math.pow(Math.max(0, poolLvl - z[0]), 1.5);
    }

    /* шаг по Куранту (только мокрые ячейки) */
    let cmax = 0.5;
    for (let k=0;k<=N;k++){
      if (Hd[k] < 0.02) continue;
      const u = q[k] / Math.max(Hd[k], 1e-6);
      const c = Math.abs(u) + Math.sqrt(g * Hd[k]);
      if (c > cmax) cmax = c;
    }
    const dt = Math.min(4, Math.max(0.02, 0.4 * ds / cmax));

    /* баланс водохранилища за фактический dt */
    if (Qsrc > 0){
      poolVol = Math.max(0, poolVol - Qsrc * dt);
      if (poolVol <= 0){ Qsrc = 0; poolLvl = z[0]; }
      else poolLvl = z[0] + H0eff * (poolVol / (h.totalVolume * 1e9));
    }

    /* граничная ячейка: уровень прорана / расход */
    Hd[0] = Math.max(0, poolLvl - z[0]) * breach;
    q[0]  = Qsrc / Math.max(wCell[0], 5);

    /* потоки на гранях (грань k — между ячейками k-1 и k) */
    hll(Hd[0], z[0], q[0], Hd[0], z[0], q[0]); F1[0] = fo[0]; F2[0] = fo[1];
    for (let k=1; k<=N; k++){
      hll(Hd[k-1], z[k-1], q[k-1], Hd[k], z[k], q[k]);
      F1[k] = fo[0]; F2[k] = fo[1];
    }
    hll(Hd[N], z[N], q[N], Hd[N], z[N], q[N]); F1[N+1] = fo[0]; F2[N+1] = fo[1];

    for (let k=1; k<=N; k++){
      /* МАССА: объёмное сохранение с шириной русла (B·H·dx),
         так что 15 млн м³ вдхр реально ограничивают глубину затопления */
      const bFaceR = 0.5*(wCell[k] + wCell[Math.min(k+1, N)]);
      const bFaceL = 0.5*(wCell[k] + wCell[Math.max(k-1, 0)]);
      let HH = Hd[k] - dt/(ds * wCell[k]) * (F1[k+1]*bFaceR - F1[k]*bFaceL);
      let QQ = q[k]  - dt/ds * (F2[k+1] - F2[k]);
      if (!isFinite(HH) || HH < 0) HH = 0;
      if (!isFinite(QQ)) QQ = 0;
      /* уклон дна (источник импульса); лимит |slope|<=0.08 — подавление
         джамп-отражений на резких DEM-порогах */
      const slp = (z[Math.min(k+1, N)] - z[Math.max(k-1, 0)]) / (2*ds);
      QQ -= dt * g * HH * Math.max(-0.08, Math.min(0.08, slp));
      /* трение Мэннинга, полу-неявно */
      if (HH > 1e-5){
        const u = QQ / HH;
        QQ /= (1 + dt * g * nM*nM * Math.abs(u) / Math.pow(Math.max(HH, 1e-3), 4/3));
      } else QQ = 0;
      Hn[k] = HH; qn[k] = QQ;
    }
    Hn[0] = Hd[0]; qn[0] = q[0];
    Hd.set(Hn); q.set(qn);
    t += dt;

    if (t >= nextFrame){
      let front = 0, hmax = 0;
      const wArr = new Float32Array(N+1);
      for (let k=0;k<=N;k++){
        wArr[k] = Hd[k] > 0.05 ? Math.min(wCell[k] + 2*mSide*Hd[k], Math.max(wCell[k]*3.5, h.visMinW ? h.visMinW : 40)) : 0;
        if (Hd[k] > 0.05){ front = k; if (Hd[k] > hmax) hmax = Hd[k]; }
        if (wArr[k] > maxW[k]) maxW[k] = wArr[k];
      }
      frames.push({ t, w: wArr, front, hmax, qsrc: Qsrc, pool: poolLvl - z[0] });
      nextFrame += 30;
      if (front >= N-2) break;
      if (Qsrc <= 0 && hmax < 0.05){ if (++stuck > 20) break; } else stuck = 0;
      if (frames.length > 700) break;
    }
  }
  const lastF = frames[frames.length-1] || { front: 0 };
  return { line, ds, N, L, cum, course, frames, maxW, simT: t, H0eff,
           frontKm: lastF.front*ds/1000,
           physInfo: `H₀=${fmtNum(H0eff,0)} м, Мэннинг n=${fmtNum(MANNING_N,2)}` };
}

/* ============================================================
   ПРОРЫВ
   ============================================================ */
async function startDamBreak(){
  if (!S.selected){ showStatusMsg('Выберите ГЭС'); return; }
  const h = HPPS.find(x => x.id === S.selected);
  if (!h || !S.cache[S.mode]?.[h.id]){ showStatusMsg('Данные недоступны'); return; }

  const params = getWaveParams(h);

  if (!S.riverCourses[h.id]){
    showStatusMsg(`Загрузка русла ${h.river}…`);
    S.riverCourses[h.id] = await loadRiverCourse(h);
  }
  const course = S.riverCourses[h.id];

  if (!course || course.length < 3){
    showStatusMsg('Не удалось построить русло');
    return;
  }

  clear(layerFlood);
  clear(layerFloodZone);

  /* ========= ФИЗИЧЕСКИЙ РЕЖИМ: расчёт прорыва по реальному профилю ======== */
  const elev = (typeof RIVER_ELEV !== 'undefined') ? RIVER_ELEV[h.id] : null;
  if (elev && elev.length >= 10){
    showStatusMsg('Расчёт прорыва по профилю DEM…');
    await sleep(30);
    const sim = simulateDamBreak(h, course, elev);
    if (!sim.frames.length){ showStatusMsg('Модель не дала волны'); return; }

    /* Зона затопления = размах затопленной ширины за весь расчёт
       (обрезаем по реально достигнутому фронту — без «нитки» до конца курса) */
    let maxK = sim.N;
    while (maxK > 1 && sim.maxW[maxK] < 1) maxK--;
    maxK = Math.max(maxK, 2);
    /* Ленту (и зону затопления, и каждый кадр) строим по ИСХОДНОМУ руслу, а не
       по сетке расчёта: на 250-метровых ячейках излучины ручья спрямляются, и
       лента шла через поля — ровно то, что было видно на Роккаланмяки. Ряд
       ширин с расчётной сетки протягивается на геометрию по дуговой
       координате (widthsAlong). */
    function bandOnCourse(widthsCell, uptoCell){
      const sEnd = Math.min(sim.L, uptoCell*sim.ds);
      let m = 1;
      while (m < course.length && sim.cum[m] <= sEnd) m++;
      const pts = course.slice(0, m), cum = sim.cum.slice(0, m);
      if (m < course.length && sim.line[uptoCell]){ pts.push(sim.line[uptoCell]); cum.push(sEnd); }
      return { pts, w: visWidths(widthsAlong(cum, widthsCell, sim.ds), visFloor(h)) };
    }
    const footPoints = () => {
      const band = bandOnCourse(sim.maxW, maxK);
      return makeBandPolygon(band.pts, band.w, h.lat);
    };

    /* перенос и зум на зону прорыва, чтобы волну было видно */
    const seg = sim.line.slice(0, maxK + 1);
    const la = seg.map(p => p[0]), lo = seg.map(p => p[1]);
    const bnds = [[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]];
    const pad  = { paddingTopLeft: [panelInsets().left + 10, 90], paddingBottomRight: [panelInsets().right + 10, 120] };
    if (REDUCED_MOTION) map.fitBounds(bnds, pad);
    else map.flyToBounds(bnds, Object.assign({ duration: 0.7 }, pad));
    let footPoly = polyAdd(layerFloodZone, footPoints(), {
      color:'#ff9400', weight:1.5, opacity:0.85, dash:true,
      fill:'#ffa726', fillOpacity:0.20
    });

    const realDur = REDUCED_MOTION ? 1 : Math.min(60, Math.max(20, sim.simT / 240));
    /* номер прогона: по нему отложенные окна понимают, что их уже отменили */
    const gen = (S.damBreakGen = (S.damBreakGen || 0) + 1);
    if (S.damBreakPop){ try { map.closePopup(S.damBreakPop); } catch(e){} S.damBreakPop = null; }
    S.damBreak = { id:h.id, progress:0, start:performance.now(), duration: realDur, course,
      /* «экранная» минимальная ширина ленты зависит от масштаба (visFloor) —
         при смене зума пунктир зоны затопления перестраивается, иначе он
         остаётся рассчитанным на том зуме, на котором сценарий включили */
      redrawBand(){ if (footPoly) footPoly.setLatLngs(footPoints()); } };
    $('alertBanner').classList.add('show');
    recompute(); render();
    $('details').innerHTML = detailsHTML(h);
    /* простое окошко у плотины: только длина волны */
    const waveKm = courseLength(sim.line.slice(0, maxK + 1)) / 1000;
    setTimeout(() => {
      if (S.damBreakGen !== gen) return;   /* прорыв уже выключили — окно не открываем */
      S.damBreakPop = openPopAt([h.lat, h.lon],
        `<b style="color:#ff5a5a">💥 ПЛОТИНА РАЗРУШЕНА</b><br>
          Длина волны: <b>${fmtNum(waveKm,1)} км</b> · расчёт ${fmtNum(sim.simT/3600,1)} ч<br>
          <span style="color:#8ba0b6;font-size:10px">${sim.physInfo}</span>`,
        { maxWidth: 300 }, popSideForFlow(h, course));
    }, 500);

    /* Один полигон на всю анимацию: меняем только вершины (setLatLngs).
       Прежний clear()+L.polygon() на каждый кадр плодил слой за слоем —
       на 60 fps это заметная нагрузка на GC и на canvas-рендер Leaflet. */
    let wavePoly = null, frontDot = null;
    function drawFrame(fr){
      const upto = Math.min(sim.N, Math.max(2, Math.round(fr.front)));
      if (upto > 1){
        const band = bandOnCourse(fr.w, upto);
        const pts = makeBandPolygon(band.pts, band.w, h.lat);
        const depth = Math.min(1, fr.hmax / 15);
        const style = {
          color:'#ff3b3b', weight:1.5, opacity:0.85,
          fill:'#ff5a5a', fillOpacity:0.26 + 0.22*depth
        };
        if (!wavePoly){
          wavePoly = L.polygon(pts, Object.assign({ interactive:false }, style)).addTo(layerFlood);
        } else {
          wavePoly.setLatLngs(pts);
          wavePoly.setStyle(style);
        }
        if (!frontDot){
          frontDot = L.circleMarker(sim.line[upto], {
            radius: 6, color:'#ff1a1a', weight:2.5, opacity:0.95,
            fillColor:'#ff5a5a', fillOpacity:0.9, interactive:false
          }).addTo(layerFlood);
        } else frontDot.setLatLng(sim.line[upto]);
      }
      $('alertBanner').innerHTML =
        `💥 ПРОРЫВ · t+${fmtClock(fr.t)} · фронт ${fmtNum(fr.front*sim.ds/1000,1)} км` +
        ` · глубина до ${fmtNum(fr.hmax,1)} м · Q прорана ${fmtNum(fr.qsrc,0)} м³/с` +
        (fr.pool > 0.05 ? ` · вдхр −${fmtNum(sim.H0eff - fr.pool,1)} м` : ' · вдхр пусто');
    }

    function finishBreak(){
      setTimeout(() => {
        clear(layerFlood);
        clear(layerFloodZone);
        wavePoly = frontDot = null;
        $('alertBanner').classList.remove('show');
        S.damBreak = null;   /* окно «ПЛОТИНА РАЗРУШЕНА» остаётся: оно подписывает
                                финальный охват; снимет его только выключение сценария */
        $('details').innerHTML = detailsHTML(h);
      }, REDUCED_MOTION ? 0 : 2600);
    }

    let fi = 0, lastRender = 0;
    function step(tNow){
      if (!S.damBreak) return;
      const elapsed = (tNow - S.damBreak.start) / 1000;
      const tSim = Math.min(sim.simT, elapsed * (sim.simT / realDur));
      S.damBreak.progress = Math.min(1, sim.simT ? tSim / sim.simT : 1);
      while (fi < sim.frames.length - 1 && sim.frames[fi+1].t <= tSim) fi++;
      drawFrame(sim.frames[fi]);
      /* волна (setLatLngs одного полигона) — каждый кадр, а render() — только
         10 раз в секунду: он заново красит маркеры всех шести станций, и на
         60 Гц это главный источник тормозов анимации. Финальный кадр — всегда. */
      if (tSim >= sim.simT || tNow - lastRender > 100){ render(); lastRender = tNow; }
      if (tSim < sim.simT) requestAnimationFrame(step);
      else finishBreak();
    }
    if (REDUCED_MOTION){
      /* просим не анимировать — показываем сразу финальный охват */
      fi = sim.frames.length - 1;
      drawFrame(sim.frames[fi]);
      finishBreak();
    } else {
      requestAnimationFrame(step);
    }
    return;
  }

  /* ======== ДЕКОРАТИВНЫЙ ФОЛБЭК (нет DEM-профиля) ======== */
  const footprint = makeFloodFootprint(h, course);
  if (footprint){
    polyAdd(layerFloodZone, footprint.pts, {
      color:'#ff9400', weight:1.5, opacity:0.85, dash:true,
      fill:'#ffa726', fillOpacity:0.28
    });
  }

  const duration = Math.max(12, params.baseDuration * 1.25);
  const gen = (S.damBreakGen = (S.damBreakGen || 0) + 1);
  if (S.damBreakPop){ try { map.closePopup(S.damBreakPop); } catch(e){} S.damBreakPop = null; }
  setTimeout(() => {
    if (S.damBreakGen !== gen) return;
    S.damBreakPop = openPopAt([h.lat, h.lon],
      `<b style="color:#ff5a5a">💥 ПЛОТИНА РАЗРУШЕНА</b><br>Длина волны: <b>${fmtNum(courseLength(course)/1000,1)} км</b>`,
      { maxWidth: 260 }, popSideForFlow(h, course));
  }, 400);
  S.damBreak = { id:h.id, progress:0, start:performance.now(), duration, course };
  $('alertBanner').innerHTML = `💥 ПРОРЫВ ПЛОТИНЫ · ${params.type} волна · затопление ${fmtNum(courseLength(course)/1000,0)} км вниз по течению` + (SHOW_DECORATIVE_WAVE?'':' · волна не отрисовывается');
  $('alertBanner').classList.add('show');

  recompute(); render();
  $('details').innerHTML = detailsHTML(h);

  function step(t){
    if (!S.damBreak) return;
    const elapsed = (t - S.damBreak.start)/1000;
    S.damBreak.progress = Math.min(1, elapsed / S.damBreak.duration);
    clear(layerFlood);
    /* декоративная волна отключена (SHOW_DECORATIVE_WAVE = false) — не рисуем полигон */
    render();
    if (S.damBreak.progress < 1) requestAnimationFrame(step);
    else setTimeout(() => {
      clear(layerFlood);
      clear(layerFloodZone);
      $('alertBanner').classList.remove('show');
      S.damBreak = null;
      $('details').innerHTML = detailsHTML(h);
    }, 2200);
  }
  requestAnimationFrame(step);
}

function stopDamBreak(){
  /* генерация прогона: отложенное открытие окна (таймер 400–500 мс) не должно
     вылезти уже после выключения сценария */
  S.damBreakGen = (S.damBreakGen || 0) + 1;
  S.damBreak = null;
  clear(layerFlood);
  clear(layerFloodZone);
  $('alertBanner').classList.remove('show');
  /* окно «ПЛОТИНА РАЗРУШЕНА» иначе висит над уже спокойной картой
     (тот же класс ошибок, что был у учебного сброса до v51) */
  if (S.damBreakPop){ try { map.closePopup(S.damBreakPop); } catch(e){} S.damBreakPop = null; }
}

/* ============================================================
   ВОДОХРАНИЛИЩЕ (с фолбэком-эллипсом)
   ============================================================ */
function drawReservoir(h, i, lf, overtop){
  if (S.reservoirs[h.id]){ layerRes.removeLayer(S.reservoirs[h.id]); delete S.reservoirs[h.id]; }
  const r = S.results[h.id];
  if (!r) return;
  /* Водохранилище рисуется только для Перовской ГЭС — остальные без контура */
  if (h.id !== 'pero') return;

  let color, fill, op;
  if (overtop){ color='#ff3b3b'; fill='#ff5252'; op=0.5; }
  else if (lf > 0.75){ color='#16b5ff'; fill='#2fc4ff'; op=0.35; }
  else { color='#16b5ff'; fill='#2fc4ff'; op=0.26; }

  /* Сценарная подсветка: паводок — красный, засуха — жёлтый. */
  if (S.scenario === 'flood'){ color='#ff2222'; fill='#ff4545'; op=0.45; }
  else if (S.scenario === 'drought'){ color='#ffb300'; fill='#ffd54a'; op=0.4; }

  /* 1) Встроенные реальные контуры (reservoirs-data.js, снимок OSM) — приоритет.
     Реальный контур в данных один — снимок при НПВ; «засуха» и «паводок»
     (g.d / g.f) оказались его побайтовыми копиями, поэтому прежнее переключение
     колец n/d/f визуально не меняло ничего. Береговая линия считается из
     площади зеркала так: полоса воды сжимается к середине русла (засуха) или
     раздувается на берега (паводок) — model.js:reservoirScenario, shorelineRings. */
  const g = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
  if (g){
    const base = Array.isArray(g) ? g : (g.n || g.d || g.f || []);
    const wd = (r.shoreWidth && r.shoreWidth[i] != null && isFinite(r.shoreWidth[i])) ? r.shoreWidth[i] : 1;
    /* Не «масштабировать кольцо вокруг точки» — на серповидном заливе Перовской
       это давало съезд: вокруг центра bbox вода отрывалась от створа на ~60 м,
       вокруг створа — хвост уезжал вверх по руслу. shorelineRings двигает каждую
       вершину поперёк русла, а плотину, устье и концы рукавов не трогает. */
    const shore = shorelineRings(base, wd);
    const group = L.layerGroup();
    shore.rings.forEach(ring => {
      polyAdd(group, ring, { color, weight:2, opacity:0.95, fill, fillOpacity: op });
    });
    /* граница НПВ — серым пунктиром, когда вода ушла или разлилась за неё:
       без неё «сдувшийся» пруд читается как ошибка данных, а не как засуха */
    if (Math.abs(wd - 1) > 0.03){
      base.forEach(ring => {
        polyAdd(group, ring, { color:'#8ba0b6', weight:1, opacity:0.8, dash:true,
                               fill:'#000000', fillOpacity:0 });
      });
    }
    group.addTo(layerRes);
    S.reservoirs[h.id] = group;
    return;
  }

  /* 2) Контур, полученный из Overpass в реальном времени */
  const osmPolys = S.reservoirsOSM[h.id];

  if (osmPolys && osmPolys.length){
    const group = L.layerGroup();
    osmPolys.forEach(parts => {
      parts.forEach(pts => {
        polyAdd(group, pts, { color: color, weight:1.6, opacity:0.9, fill: fill, fillOpacity: op });
      });
    });
    group.addTo(layerRes);
    S.reservoirs[h.id] = group;
    return;
  }

  /* Фолбэк-эллипс */
  const areaKm2 = r.area[i];
  const areaM2 = areaKm2 * 1e6;
  const aspect = 3;
  const a = Math.sqrt(areaM2 * aspect / Math.PI);
  const b = Math.sqrt(areaM2 / (Math.PI * aspect));

  const upRad = ((h.flowDir || 180) + 180) * Math.PI / 180;
  const upLat = Math.cos(upRad);
  const upLon = Math.sin(upRad);
  const perpLat = -upLon;
  const perpLon = upLat;

  const R = 6371000;
  const latR = h.lat * Math.PI / 180;

  const cLat = h.lat + (a * upLat) / R * 180 / Math.PI;
  const cLon = h.lon + (a * upLon) / (R * Math.cos(latR)) * 180 / Math.PI;

  const pts = [];
  const N = 48;
  for (let k = 0; k < N; k++){
    const ang = k * 2 * Math.PI / N;
    const localAlong  = a * Math.cos(ang);
    const localAcross = b * Math.sin(ang);
    const dLat = (localAlong * upLat + localAcross * perpLat) / R * 180 / Math.PI;
    const dLon = (localAlong * upLon + localAcross * perpLon) / (R * Math.cos(latR)) * 180 / Math.PI;
    pts.push([cLat + dLat, cLon + dLon]);
  }

  const poly = polyAdd(layerRes, pts, { color: color, weight:1.6, opacity:0.9, fill: fill, fillOpacity: op });
  S.reservoirs[h.id] = poly;
}

/* ============================================================
   ИНТЕРФЕЙС
   ============================================================ */
function buildUI(){
  const list = $('hppList');
  $('hppCount').textContent = `(${HPPS.length})`;

  /* Штамп сборки — из version.js, а не из текста вперемешку с кодом:
     раньше в index.html и в sw.js версии «v45» жили раздельно и разъезжались. */
  const stamp = $('buildStampVer');
  if (stamp) stamp.textContent = window.APP_VERSION || 'dev';

  /* Кнопка ⟳: сбросить ВСЕ локальные кэши (данные, русла, контуры) и shell SW.
     Раньше чистился только ges_cache_*, и «залипшие» русла/контуры OSM
     оставались в localStorage навечно (TTL у них 30 суток). */
  $('refreshBtn').onclick = async () => {
    setStatus('очистка кэша…');
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        if (k && (k.startsWith('ges_'))) kill.push(k);
      }
      kill.forEach(k => localStorage.removeItem(k));
    } catch(e){}
    invalidateCacheSnapshot();
    try {
      if ('caches' in window){
        const ks = await caches.keys();
        await Promise.all(ks.map(k => caches.delete(k)));
      }
    } catch(e){}
    location.reload();
  };

  HPPS.forEach(h => {
    /* <button> вместо <div onclick>: список становился доступным мышью;
       теперь станции переключаются с клавиатуры и читаются скринридером */
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'hppItem';
    item.dataset.id = h.id;
    item.setAttribute('aria-pressed', 'false');
    item.setAttribute('aria-label', `${h.name}, река ${h.river}, ${capLabel(h)}`);
    item.innerHTML = `<span class="src loading" aria-hidden="true"></span><span class="nm">${h.name}</span><span class="mw">…</span>`;
    item.onclick = () => selectHPP(h.id, true);
    list.appendChild(item);
    createMarker(h);
  });
  buildColorLegend();
  updateStationAvailability();

  $('slider').oninput = e => { S.idx = +e.target.value; render(); };
  /* отпускание бегунка — карточка догоняет дату без всякого троттлинга */
  $('slider').onchange = () => scheduleCard(true);
  $('playBtn').onclick = togglePlay;

  /* Панели на узких экранах складываются в выдвижные — иначе на телефоне
     нечем выбирать станцию и не видно графиков (раньше display:none). */
  const toggles = [
    ['panelToggle', 'sidebar'],
    ['chartToggle', 'chartPanel']
  ];
  toggles.forEach(([btnId, panelId]) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.onclick = () => {
      /* у графиков своё состояние (show + remember), не просто .open */
      if (panelId === 'chartPanel'){ setChartsVisible(!chartsVisible()); return; }
      const panel = $(panelId);
      const open = panel.classList.toggle('open');
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
  });
  const hideBtn = $('chartHideBtn'), showBtn = $('chartShowBtn');
  if (hideBtn) hideBtn.onclick = () => setChartsVisible(false);
  if (showBtn) showBtn.onclick = () => setChartsVisible(true);
  /* Esc закрывает по одному слою: сначала графики, затем ящик со станциями */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (chartsVisible()){ setChartsVisible(false); return; }
    const side = $('sidebar');
    if (side && side.classList.contains('open')){
      side.classList.remove('open');
      const b = $('panelToggle');
      if (b){ b.classList.remove('on'); b.setAttribute('aria-expanded','false'); }
    }
  });
  /* намерение из прошлой сессии: «я графики не просил» */
  if (!chartsWanted()) setChartsVisible(false, {remember:false});
  else if ($('chartHideBtn')) $('chartHideBtn').disabled = !chartsVisible();

  /* Сценарии */
  document.querySelectorAll('.scenBtn').forEach(btn => {
    btn.onclick = () => applyScenario(btn.dataset.scen);
  });

  /* При активном сценарии «Сброс» доступна только Перовская — остальные станции блокируются */
  function updateStationAvailability(){
    const isRelease = S.scenario === 'release';
    document.querySelectorAll('.hppItem').forEach(el => {
      const isPero = el.dataset.id === 'pero';
      const off = isRelease && !isPero;
      el.classList.toggle('disabled', off);
      el.disabled = off;                    // вместо танца со style.opacity/pointerEvents
      el.title = off ? 'Сценарий сброса активен только для Перовской МГЭС' : '';
    });
    /* Сценарии: при сбросе доступны только Норма, Сброс и Сброс настроек */
    document.querySelectorAll('.scenBtn').forEach(b => {
      const off = isRelease && b.dataset.scen !== 'normal' && b.dataset.scen !== 'reset' && b.dataset.scen !== 'release';
      b.disabled = off;
      b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
    });
  }

  /* Единая точка применения сценария: раньше «выключить анимации, пересчитать,
     перерисовать, обновить паспорт» было продублировано в трёх ветках,
     и кнопка «Сброс настроек» оставалась подсвеченной вместе с «Нормой». */
  function applyScenario(sc){
    const isReset = sc === 'reset';
    if (isReset) S.scenario = 'normal';
    else if (sc === S.scenario && sc !== 'dam_break' && sc !== 'release') return;
    else S.scenario = sc;

    /* анимации чужих сценариев глушим всегда, перед переходом */
    if (S.scenario !== 'dam_break') stopDamBreak();
    if (S.scenario !== 'release') stopRelease();

    document.querySelectorAll('.scenBtn').forEach(b => {
      const on = b.dataset.scen === S.scenario;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    recompute(); render();
    updateStationAvailability();
    if (S.selected){
      const h = HPPS.find(x => x.id === S.selected);
      if (h && S.scenario !== 'release') $('details').innerHTML = detailsHTML(h);
      updateChart();
    }
    if (S.scenario === 'dam_break') startDamBreak();
    else if (S.scenario === 'release') startRelease();
  }

  /* Легенда цветов меток: без неё «красный/зелёный» — чистая догадка,
     а для пользователя с КЦМ цветовая шкала вообще не информация. */
  function buildColorLegend(){
    const box = $('legend');
    if (!box) return;
    const scale = [['>75%', '#3ddc84'], ['45–75%', '#a8e05f'], ['20–45%', '#ffb02e'], ['5–20%', '#ff8a3d'], ['<5%', '#ff6b6b']];
    box.innerHTML = '<span class="lgTitle">загрузка</span>' +
      scale.map(([t,c]) => `<span class="lgItem"><i style="background:${c}"></i>${t}</span>`).join('') +
      '<span class="lgItem"><i style="background:#ff3b3b;box-shadow:0 0 0 2px #fff"></i>прорыв / перелив</span>' +
      '<span class="lgItem"><i style="background:#555"></i>нет данных</span>';
  }

  /* Опции ГЕНЕРИРУЮТСЯ отдельно на каждый график. Раньше был один общий
     baseOpts, и оба Chart получали ссылки на одни и те же вложенные
     объекты (scales.x, plugins.legend): правка cp.options.scales.x…
     незаметно меняла второй график. */
  function chartOptions(kind){
    const power = kind === 'power';
    return {
      /* ВАЖНО: type — свойство КОНФИГА, а не options (см. chartConfig ниже) */
      maintainAspectRatio:false, animation:false,
      interaction:{ mode:'index', intersect:false },
      elements:{ point:{ radius:0 } },
      plugins:{
        legend:{ display:false },
        /* подсказка была отключена на графике мощности — при этом
           updateChart() каждый кадр готовил для неё fmtAxisPower() */
        tooltip:{
          enabled:true, mode:'index', intersect:false,
          backgroundColor:'rgba(16,22,30,.95)', borderColor:'#2a3644', borderWidth:1,
          titleColor:'#dbe6f2', bodyColor:'#dbe6f2', padding:8, font:{size:11},
          callbacks:{ label: ctx => power
            ? fmtAxisPower(ctx.parsed.y)
            : fmtNum(ctx.parsed.y, 2) + ' м' }
        }
      },
      scales:{
        x:{ display:!power, ticks:{ color:'#6d8199', maxTicksLimit:6, font:{size:8} }, grid:{ color:'rgba(255,255,255,.04)' } },
        y:{ position:'left', ticks:{ color:'#dbe6f2', font:{size:9} }, grid:{ color:'rgba(255,255,255,.05)' },
          title:{ display:true, color:'#8ba0b6', font:{size:10}, text: power ? 'Мощность' : 'Уровень ВБ, м' } }
      }
    };
  }
  /* type обязан лежать в КОРНЕ конфига: Chart.js читает config.type и по нему
     ищет контроллер ('line'). Внутри options он игнорируется, а на пустом
     datasets ошибка всплывает лишь при первом chart.update() — то есть
     молча ломает карту, графики и перемотку. Поэтому — отдельный конфиг. */
  const chartConfig = kind => ({
    type:'line',
    data:{ labels:[], datasets:[] },
    options: chartOptions(kind)
  });
  /* canvas, а не getContext('2d'): Chart.js разворачивает и так и так, но
     элемент не зависит от того, вернёт ли jsdom/тест-стаб корректный .canvas */
  S.chartPower = new Chart($('chartPowerC'), chartConfig('power'));
  S.chartLevel = new Chart($('chartLevelC'), chartConfig('level'));

  /* Режимы: тот же «один объект на всех» был в обработчиках — плюс aria
     для переключателя (роль tablist без aria-selected скринридером
     читается как три никаких не связанных кнопки). */
  document.querySelectorAll('#modeTabs button').forEach(btn => {
    btn.onclick = async () => {
      if (S.loading) return;
      document.querySelectorAll('#modeTabs button').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      S.mode = btn.dataset.mode;
      stopDamBreak(); stopRelease();
      S.scenario = 'normal';
      document.querySelectorAll('.scenBtn').forEach(b => {
        const on = b.dataset.scen === 'normal';
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      updateStationAvailability();
      try { await loadPeriod(S.mode); }
      catch(e){ console.error('loadPeriod ' + S.mode + ':', e); }
    };
    btn.onkeydown = e => {
      const tabs = [...document.querySelectorAll('#modeTabs button')];
      const at = tabs.indexOf(btn);
      const to = e.key === 'ArrowRight' ? tabs[at+1] : e.key === 'ArrowLeft' ? tabs[at-1] : null;
      if (to){ e.preventDefault(); to.focus(); to.click(); }
    };
  });
}

/* ============================================================
   РЕНДЕР
   ============================================================ */
/* Цвет метки по загрузке; для «Иглы» (capacityMW = 0) lf теперь 0, а не NaN. */
function markerColor(h, r, i){
  const broken = (S.scenario === 'dam_break' && S.selected === h.id);
  if (broken || r.level[i] > h.nmu - 0.15) return '#ff3b3b';
  const lf = r.lf[i];
  return lf>0.75?'#3ddc84':lf>0.45?'#a8e05f':lf>0.20?'#ffb02e':lf>0.05?'#ff8a3d':'#ff6b6b';
}

function render(){
  const i = S.idx;
  if (!S.dates[i]) return;
  $('dateBox').textContent = fmtDateRu(S.dates[i]);
  $('slider').value = i;

  HPPS.forEach(h => {
    const mk = S.markers[h.id];
    if (!mk) return;
    const r = S.results[h.id];
    const k = ki(h);                       // индекс ряда станции под ЭТУ дату
    if (!r || k < 0){
      mk.setStyle({ fillColor:'#555', color:'#ffffff', weight:2.5, opacity:0.7, fillOpacity:0.7 });
      return;
    }
    let col;
    try {
      col = markerColor(h, r, k);
      mk.setStyle({ fillColor: col, color:'#ffffff', weight:2.5, opacity:1, fillOpacity:1 });
      /* Открытый попап обновляем точечно — один станция, а не шесть */
      const pop = mk.getPopup && mk.getPopup();
      if (pop && pop.isOpen()) pop.setContent(popupHTML(h, r, k, col));
    } catch(e){
      /* Одна битая станция не должна обрывать отрисовку остальных */
      console.warn('render ' + h.id + ':', e.message);
      mk.setStyle({ fillColor:'#555', opacity:0.7, fillOpacity:0.7 });
    }
  });

  if (S.selected){
    const h = HPPS.find(x => x.id === S.selected);
    const r = h && S.results[h.id];
    const k = h ? ki(h) : -1;
    if (r && k >= 0){
      const isBroken = (S.scenario === 'dam_break' && S.selected === h.id);
      if (isBroken){
        if (S.reservoirs[h.id]){ layerRes.removeLayer(S.reservoirs[h.id]); delete S.reservoirs[h.id]; }
      } else {
        drawReservoir(h, k, r.lf[k], r.level[k] > h.nmu - 0.15);
      }
    }
    Object.keys(S.reservoirs).forEach(id => {
      if (id !== S.selected){ layerRes.removeLayer(S.reservoirs[id]); delete S.reservoirs[id]; }
    });
  }

  if (S.selected) updateChart();
  /* в «прорыве» карточку ведёт цикл кадров — не мешаем ему */
  if (S.selected && !S.damBreak) scheduleCard();
}

/* Карточка выбранной станции — по ту дату, что стоит на бегунке. Раньше её
   HTML пересобирался только при смене станции или сценария, поэтому при
   перемотке (и в особенности в режиме климата, где ряд месячный) «Текущий
   уровень», «Дата ряда» и площадь берегового контура оставались вчерашними:
   зеркало на карте двигалось, а цифры — нет. Пересборка недешёвая (detailsHTML
   считает деформацию берега), поэтому не чаще раза в 250 мс, но последний
   кадр прогоняем обязательно — иначе панель встанет на середине ряда.
   В «сбросе» карточка принадлежит сценарию, её не трогаем. */
function scheduleCard(force){
  const key = S.idx + '|' + S.mode + '|' + S.scenario;
  if (S.cardKey === key && !force) return;
  const now = (window.performance || Date).now();
  if (!force && now - (S.lastCardUpdate || -1e9) <= 250){
    if (!S.cardTimer) S.cardTimer = setTimeout(() => { S.cardTimer = 0; scheduleCard(true); }, 260);
    return;
  }
  if (S.cardTimer){ clearTimeout(S.cardTimer); S.cardTimer = 0; }
  const h = HPPS.find(x => x.id === S.selected);
  if (!h || S.scenario === 'release') return;
  S.cardTimer = 0;
  S.cardKey = key;
  S.lastCardUpdate = now;
  $('details').innerHTML = detailsHTML(h);
}

function capLabel(h){
  return h.powerLabel ? h.powerLabel : (fmtNum(h.capacityMW || 0, h.capacityMW >= 1 ? 0 : 2) + ' МВт');
}
function popupHTML(h, r, i, col){
  const isBroken = (S.scenario === 'dam_break' && S.selected === h.id);
  const overtop = r.level[i] > h.nmu - 0.15;
  const lf = r.lf[i] * 100;
  const src = S.sources[h.id];
  const srcLabel = src==='api'?'🟢 онлайн':src==='cache'?'🟡 кэш':'🔴 офлайн';
  const status = isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">💥 ПЛОТИНА РАЗРУШЕНА</div>'
              : overtop ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">⚠ КРИТИЧЕСКИЙ УРОВЕНЬ</div>' : '';
  return `<h4>${h.name}</h4>
  <div style="color:#8ba0b6;margin-bottom:8px">р. ${h.river} · ${capLabel(h)} · ${srcLabel}</div>
  ${status}
  <div class="kv"><span>Мощность</span><span style="color:${col};font-weight:700">${h.notHPP ? '—' : fmtMW(r.power[i])}</span></div>
  <div class="kv"><span>Загрузка</span><span>${h.notHPP ? '—' : fmtNum(lf, 1) + ' %'}</span></div>
  <div class="kv"><span>Уровень ВБ</span><span>${fmtNum(r.level[i], 2)} м</span></div>
  <div class="kv"><span>Напор</span><span>${fmtNum(r.head[i], 1)} м</span></div>
  <div class="kv"><span>Расход</span><span>${fmtNum(r.flow[i], 1)} м³/с</span></div>
  <div class="kv"><span>Сброс</span><span>${fmtNum(r.spill[i], 1)} м³/с</span></div>
  <div class="kv"><span>Зеркало</span><span>${fmtNum(r.area[i], 2)} км²</span></div>
  <button type="button" class="popMore" data-id="${h.id}">Паспорт и график →</button>`;
}

/* ============================================================
   ВЫБОР ГЭС
   ============================================================ */
async function selectHPP(id, fromList){
  /* При активном сценарии сброса переключение доступно только на Перовскую */
  if (S.scenario === 'release' && id !== 'pero') return;
  S.selected = id;
  const h = HPPS.find(x => x.id === id);
  if (!h) return;

  document.querySelectorAll('.hppItem').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  $('details').innerHTML = detailsHTML(h);
  /* панель не показываем «вслепую»: если пользователь её скрыл, остаётся
     скрытой; если открыта — перерисовать под новую станцию */
  if (chartsWanted() || chartsVisible()) setChartsVisible(true, {remember:false});
  $('chartTitle').textContent = h.name;
  $('chartSub').textContent = `р. ${h.river}`;

  if (map){
    /* Зум на станцию при ЛЮБОМ выборе — и из списка, и кликом по маркеру.
       Исключение — сценарии, которые сами правят кадр (прорыв, учебный сброс):
       у них свой fitBounds, и тянуть его обратно нельзя. */
    const framing = S.scenario === 'dam_break' && S.damBreak && S.damBreak.id === id;
    if (!framing && S.scenario !== 'release') panToStation(h);
    /* попап — после панорамы (Leaflet попапы зум не закрывает, так рисуется чище) */
    if (S.scenario !== 'release'){
      setTimeout(() => { const m = S.markers[id]; if (m) m.openPopup(); },
        (REDUCED_MOTION || framing) ? 0 : 800);   /* попап — когда перелёт закончился */
    }
  }

  if (!S.cache[S.mode]?.[id] && !S.loadingStation[id] && apiAvailable !== false){
    S.loadingStation[id] = true;
    hppRowSet(id, 'loading');
    const mode = S.mode;
    let res;
    try {
      res = await loadStation(h, mode);
    } catch(e){
      /* Ошибка сети не должна оставлять станцию навеки в состоянии
         «загрузка» (флаг снимается, точка краснеет — дальше работает ретрай) */
      delete S.loadingStation[id];
      hppRowSet(id, 'synth', capLabel(h));
      console.warn('loadStation ' + h.name + ':', e.message);
      return;
    }
    delete S.loadingStation[id];
    if (S.mode !== mode) return;      // режим сменили, пока шёл запрос
    setStationSeries(h, mode, res.data, res.source);
    hppRowSet(id, res.source, capLabel(h));
    syncAxis(mode, true);
    recompute(); render();
  }

  /* Русло загружается для всех станций (нужно для прорыва), водохранилище — только для Перовской */
  if (!S.riverCourses[h.id] && !S.loadingRiver[h.id]){
    S.loadingRiver[h.id] = loadRiverCourse(h).then(c => {
      S.riverCourses[h.id] = c; delete S.loadingRiver[h.id];
      if (S.selected === h.id) $('details').innerHTML = detailsHTML(h);
      return c;
    }).catch(() => { delete S.loadingRiver[h.id]; });
  }
  if (h.id === 'pero'){
    const embeddedRes = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
    if (!embeddedRes && !S.reservoirsOSM[h.id] && !S.loadingRes[h.id]){
      S.loadingRes[h.id] = loadReservoirOSM(h).then(p => {
        S.reservoirsOSM[h.id] = p; delete S.loadingRes[h.id];
        if (S.selected === h.id) render();
        return p;
      }).catch(() => { S.reservoirsOSM[h.id] = []; delete S.loadingRes[h.id]; });
    }
  }

  if (S.scenario === 'dam_break') startDamBreak();
  else { updateChart(); render(); }
}

function detailsHTML(h){
  const r = S.results[h.id];
  const i = ki(h);
  if (!r || i < 0) return `<h3>${h.name}</h3><p style="color:#8ba0b6">Данные загружаются…</p>`;
  const isBroken = (S.scenario === 'dam_break' && S.selected === h.id);
  const overtop = r.level[i] > h.nmu - 0.15;
  const src = S.sources[h.id];
  const srcLabel = src==='api'?'<span style="color:#3ddc84">🟢 свежие данные</span>'
    : src==='cache'?'<span style="color:#ffb02e">🟡 из кэша</span>'
    : '<span style="color:#ff6b6b">🔴 офлайн-режим</span>';
  const wp = getWaveParams(h);
  const course = S.riverCourses[h.id];
  const courseInfo = course
    ? `русло: ${fmtNum(courseLength(course)/1000, 1)} км`
    : (S.loadingRiver[h.id] ? 'русло загружается…' : 'русло не загружено');
  const gg = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
  const resEmbedded = !!(gg && (Array.isArray(gg) ? gg.length : (gg.n && gg.n.length)));
  /* Про зеркало воды: площадь — из модели, поправка сценария — отдельной
     строкой. Без неё пользователь видит только расход и не понимает, почему
     берег уполз; с ней видно, что это схема, а не расчёт подпорной кривой. */
  const scenScheme = (S.scenario === 'flood' || S.scenario === 'drought');
  const dhNow = (r.shoreDh && isFinite(r.shoreDh[i])) ? r.shoreDh[i] : null;
  const wdNow = (r.shoreWidth && isFinite(r.shoreWidth[i])) ? r.shoreWidth[i] : null;
  /* Строка про площадь — про РИСУЕМЫЙ контур (снимок OSM при НПВ, помноженный
     на поправку), а не про модельную площадь: модель даёт для пруда 0,001 км²
     (своя кривая площадь), и ряды «вот контур на весь залив» + «вот 0,001 км²»
     читались бы как противоречие. Модельное зеркало осталось в попапе — «Зеркало». */
  /* Долю площади считаем по РИСУЕМОМУ кольцу, а не как «×w»: концы русла и
     плотина стоят, поэтому фактическая площадь всегда скромнее «бумажной». */
  /* «на сколько раз шире/уже полоса»: в паводок/засуху — множитель СХЕМЫ (год),
     в «норме» — фактический размер полосы против снимка при НПВ */
  const wdTxt = (scenScheme && r.shoreScheme && isFinite(r.shoreScheme[i])) ? r.shoreScheme[i] : wdNow;
  const shoreDrawn = resEmbedded
    ? shorelineRings(Array.isArray(gg) ? gg : (gg.n || gg.d || gg.f || []), wdNow ?? 1)
    : null;
  const ratio = shoreDrawn ? shoreDrawn.areaRatio : 1;
  const areaShow = h.areaNMU ? h.areaNMU * ratio : null;
  const waterRows = `<div class="kv"><span>Площадь берегового контура</span><span>${
      areaShow != null ? fmtNum(areaShow, 3) + ' км² · ' +
        (Math.abs(ratio - 1) > 0.01 ? fmtNum(ratio * 100, 0) + '% снимка при НПВ' : 'снимок при НПВ') : '—'
    }</span></div>` + (
      dhNow != null && Math.abs(dhNow) > 1e-3
        ? `<div class="kv"><span>${scenScheme
            ? 'Поправка «' + (S.scenario === 'flood' ? 'многоводный год' : 'маловодный год') + '»'
            : 'Отметка ниже НПУ'}</span><span style="color:${dhNow > 0 ? '#ff8a3d' : '#ffd54a'}">${
            (dhNow > 0 ? '+' : '') + fmtNum(dhNow, 2) + ' м' + (scenScheme ? ' к отметке' : ' (ровно ' + fmtNum(r.level[i], 2) + ' м)') + ' · берег ' +
            (wdTxt != null && wdTxt < 1 ? 'сжат ×' : 'раздут ×') + fmtNum(wdTxt ?? 1, 2) + ' поперёк русла'
          }</span></div>`
        : ''
    );
  const resInfo = resEmbedded
    ? `водохранилище: реальный контур OSM (встроен)${dhNow != null ? ' · зеркало пересчитано по водности года (схема)' : ''}`
    : S.reservoirsOSM[h.id]
      ? (S.reservoirsOSM[h.id].length ? `водохранилище: ${S.reservoirsOSM[h.id].length} объектов OSM` : 'водохранилище: фолбэк')
      : (S.loadingRes[h.id] ? 'водохранилище загружается…' : 'водохранилище: фолбэк');

  /* Провенанс: Open-Meteo считает реку по сетке 0.1° и это ГИДРОЛОГИЧЕСКАЯ
     МОДЕЛЬ (CAMS), а не створ у плотины. Для прудов 0,1-0,6 МВт это
     видно глазами — молча приписывать ряду статус «расход реки» нельзя. */
  const meta = (S.cache[S.mode]?.[h.id] || {}).meta;
  const prov = meta && meta.latitude != null
    ? `ряд: Open-Meteo flood${meta.model ? ' ('+meta.model+')' : ''}, ячейка сетки ${fmtNum(meta.latitude,3)}, ${fmtNum(meta.longitude,3)}${meta.grid_code ? ' · ' + meta.grid_code + '°' : ''}`
    : (S.mode === 'climate' ? 'ряд: ' + ((meta && meta.model) || 'CMIP6 ens-mean SSP5-8.5') + ', шаг — месяц'
                            : 'ряд: локальная синтетика (офлайн-фолбэк), шаг — сутки');

  return `<h3>${h.name}</h3>
  <div style="font-size:11px;margin-bottom:6px">${srcLabel}</div>
  ${isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">💥 ПЛОТИНА РАЗРУШЕНА</div>' : ''}
  ${overtop && !isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">⚠ КРИТИЧЕСКИЙ УРОВЕНЬ</div>' : ''}
  <div class="kv"><span>Река</span><span>${h.river}</span></div>
  <div class="kv"><span>Водохранилище</span><span>${h.reservoirName || '—'}</span></div>
  ${h.resCoords ? `<div class="kv"><span>Координаты вдхр</span><span>${h.resCoords}</span></div>` : ''}
  <div class="kv"><span>Координаты плотины</span><span>${fmtNum(h.lat,4)}, ${fmtNum(h.lon,4)}</span></div>
  <div class="kv"><span>Течение (flowDir)</span><span>${h.flowDir}°</span></div>
  <div class="kv"><span>Установленная мощность</span><span>${capLabel(h)}</span></div>
  <div class="kv"><span>Тип плотины</span><span>${h.damType || '—'}</span></div>
  <div class="kv"><span>Расчётный напор</span><span>${fmtNum(h.head,1)} м</span></div>
  ${h.note ? `<div class="kv"><span>Примечание</span><span style="color:#ffb02e">${h.note}</span></div>` : ''}
  <div class="kv"><span>НПУ / УМО</span><span>${fmtNum(h.nmu,1)} / ${fmtNum(h.umo,1)} м</span></div>
  <div class="kv"><span>Дата ряда</span><span>${fmtDateRu(S.dates[S.idx])}</span></div>
  <div class="kv ${overtop?'danger':''}"><span>Текущий уровень</span><span>${fmtNum(r.level[i],2)} м</span></div>
  ${waterRows}
  <div class="kv ${overtop?'danger':''}"><span>Текущая мощность</span><span>${h.notHPP ? '—' : fmtMW(r.power[i])}</span></div>
  <div class="kv"><span>Выработка за период</span><span>${fmtEnergyKWh(r.kwh)}</span></div>
  <div style="margin-top:8px;padding:8px 10px;background:rgba(255,59,59,.08);border:1px solid rgba(255,59,59,.25);border-radius:8px;font-size:11px;line-height:1.5">
    <div style="color:#ff6b6b;font-weight:700;margin-bottom:4px">🌊 Волна прорыва — ${wp.type}</div>
    <div>${wp.description}</div>
    <div style="color:#8ba0b6;margin-top:4px">скорость ≈ ${fmtNum(wp.speedMs,0)} м/с · ширина до ${fmtNum(wp.maxWidth/1000,1)} км</div>
    ${(typeof RIVER_ELEV !== 'undefined' && RIVER_ELEV[h.id]) ?
      `<div style="color:#39d353;margin-top:4px">∿ расчёт: профиль дна DEM, водосливная кривая прорана, Мэннинг n=${fmtNum(MANNING_N,3)}</div>` : ''}
    <div style="color:#8ba0b6;margin-top:2px;font-size:10px">${courseInfo}</div>
    <div style="color:#8ba0b6;font-size:10px">${resInfo}</div>
    <div style="color:#6d8199;font-size:10px;margin-top:2px">${prov}</div>
  </div>`;
}

function updateChart(){
  if (!S.chartPower || !S.chartLevel) return;
  if (S.scenario === 'release' && S.release){ return; }
  if (!S.selected) return;
  const now = performance.now();
  if (now - S.lastChartUpdate < CHART_THROTTLE_MS) return;
  S.lastChartUpdate = now;

  const r = S.results[S.selected];
  const h = HPPS.find(x => x.id === S.selected);
  if (!r || !h) return;
  const len = S.timeLen[h.id] || r.level.length;
  if (!len) return;

  /* Окно берём по единой оси дат, а значения — по ДАТЕ каждого окна.
     Прямое r.power[k] ломалось на станции с рядом другой длины
     (месячный климат против суточной истории): getMonth() индексы
     расходились, и график рисовал «дырки»/чужие точки. */
  const i = S.idx, W = CHART_WINDOW;
  const a = Math.max(0, i-W), b = Math.min(S.dates.length, i+W);
  const labels=[], pw=[], lv=[];
  for (let k = a; k < b; k++){
    const rk = alignIndex(k, len, S.timeIdx[h.id], S.dates[k]);
    if (rk < 0) continue;
    labels.push(chartTickLabel(S.dates[k], a, b));
    pw.push(r.power[rk]);
    lv.push(r.level[rk]);
  }
  if (!labels.length) return;

  const cp = S.chartPower;
  const cl = S.chartLevel;
  /* Сглаживание нужно месячному климат-ряду: заполнение-слив скачет
     от месяца к месяцу и глаз не цепляется за тренд. */
  const win = S.mode === 'climate' ? 5 : 1;
  const pwS = movingAverage(pw, win).map(v => Math.round(v*100)/100);
  const lvS = movingAverage(lv, win).map(v => Math.round(v*100)/100);
  const idxMark = Math.max(0, Math.min(i - a, labels.length - 1));

  cp.data.labels = labels;
  cp.data.datasets = [{
    data:pwS, borderColor:'#31c9ff', backgroundColor:'rgba(49,224,255,.06)',
    borderWidth:1.6, fill:false, tension:.15,
    pointRadius: labels.map((_,j) => j === idxMark ? 3 : 0),
    pointBackgroundColor:'#ffffff'
  }];
  cp.options.scales.y.title.text = h.notHPP ? 'нет ГЭС' : 'Мощность';
  cp.options.scales.x.display = false;
  cp.options.plugins.legend.display = false;
  const lblP = $('chartLabelPower'), lblL = $('chartLabelLevel');
  if (lblP) lblP.textContent = (h.notHPP ? 'мощность не вырабатывается' : 'мощность, МВт') +
    (S.scenario === 'flood' ? ' · сценарий: паводок (весенний разбор по календарю)'
     : S.scenario === 'drought' ? ' · сценарий: летняя межень' : '');
  if (lblL) lblL.textContent = 'уровень водохранилища, м (НПУ ' + fmtNum(h.nmu,1) + ' · УМО ' + fmtNum(h.umo,1) + ')';
  cp.options.scales.y.ticks.callback = v => fmtAxisPower(+v);
  /* Фиксированный вертикальный масштаб — линия не липнет к краям графика */
  const pMax = Math.max(h.capacityMW || 0, ...pw) * 1.15;
  cp.options.scales.y.min = 0;
  cp.options.scales.y.max = pMax > 0 ? pMax : 1;
  cp.update('none');

  cl.data.labels = labels;
  cl.data.datasets = [{
    data:lvS, borderColor:'#ffb02e', backgroundColor:'rgba(255,176,46,.06)',
    borderWidth:1.6, fill:false, tension:.15,
    pointRadius: labels.map((_,j) => j === idxMark ? 3 : 0),
    pointBackgroundColor:'#ffffff'
  }];
  cl.options.scales.y.title.text = 'Уровень ВБ, м';
  cl.options.scales.y.ticks.callback = v => fmtNum(+v, 1);
  const lMin = (h.umo != null ? h.umo : Math.min(...lvS)) - 0.5;
  const lMax = (h.nmu != null ? h.nmu : Math.max(...lvS)) + 0.5;
  cl.options.scales.y.min = lMin;
  cl.options.scales.y.max = Math.max(lMax, lMin + 0.5);
  cl.options.plugins.tooltip.callbacks.label = ctx => fmtNum(ctx.parsed.y, 2) + ' м';
  cl.update('none');
}

/* Подпись даты на оси X: для суточных рядов — «дд.мм», для месячных
   и длинных окон — «гггг-мм». */
function chartTickLabel(iso, a, b){
  const d0 = S.dates[a], d1 = S.dates[Math.min(b-1, S.dates.length-1)];
  const spanDays = Math.abs((isoToUTC(d1) - isoToUTC(d0)) / 86400000);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return String(iso || '');
  return spanDays > 180 ? m[1].slice(2) + '-' + m[2] : m[2] + '.' + m[3];
}

/* ============================================================
   АНИМАЦИЯ
   ============================================================ */
function togglePlay(){
  if (!S.dates.length) return;
  S.playing = !S.playing;
  $('playBtn').textContent = S.playing ? '❚❚' : '▶';
  if (S.playing){ animAcc = 0; animLast = 0; requestAnimationFrame(loop); }
}

function loop(t){
  if (!S.playing) return;
  if (!animLast) animLast = t;
  const dt = t - animLast; animLast = t;
  animAcc += dt;
  const speed = +$('speed').value;
  if (animAcc > speed * 16){
    animAcc = 0;
    S.idx = (S.idx + 1) % S.dates.length;
    render();
  }
  requestAnimationFrame(loop);
}

/* ============================================================
   СТАРТ
   ============================================================ */
/* ============================================================
   ПЕРЕТАСКИВАНИЕ ОКЕН МЫШКОЙ
   ============================================================ */
/* ============================================================
   ПЕРЕТАСКИВАНИЕ И РЕСАЙЗ ОКОН
   Панели «запоминаются» в localStorage и не могут уехать за край экрана:
   раньше их можно было утащить в никуда, и вернуть только перезагрузкой.
   Тащим только рабочие окна (список и графики) — статус, баннер и таймлайн
   были drag-таргетами без всякого смысла и мешали обычным кликам.
   ============================================================ */
/* ============================================================
   ВИДИМОСТЬ ГРАФИКОВ
   ============================================================ */
/* Скрывать/показывать панель можно четырьмя способами — ✕ в шапке, тумблер 📈
   на узком экране, Esc и пилюля «📈 Графики» на месте спрятанной панели.
   Все они идут через setChartsVisible: с двумя независимыми
   classList.toggle('show') состояния разъезжаются, а прежнее
   $('chartPanel').classList.add('show') в selectHPP ещё и молча возвращало
   панель при выборе следующей станции — то есть «скрыть» не работало.
   Намерение пользователя запоминается в localStorage (ges_charts_v1):
   перезагрузка страницы не должна включать графики вопреки ему. */
const CHARTS_KEY = 'ges_charts_v1';
function chartsWanted(){
  try { return localStorage.getItem(CHARTS_KEY) !== '0'; } catch(e){ return true; }
}
function chartsVisible(){
  const panel = $('chartPanel');
  return !!panel && panel.classList.contains('show');
}
/* canvas внутри display:none имеет размер 0×0: Chart.js пересчитывает
   геометрию только на resize(), иначе после показа остаются пустые рамки */
function resizeCharts(){
  if (S.chartPower) S.chartPower.resize();
  if (S.chartLevel) S.chartLevel.resize();
}
function setChartsVisible(on, opts){
  const o = opts || {};
  const panel = $('chartPanel');
  if (!panel) return;
  on = !!on;
  const from = document.activeElement;
  panel.classList.toggle('show', on);
  panel.classList.toggle('open', on && NARROW());   // на узком — та же шухляда
  const tog = $('chartToggle');
  if (tog){
    tog.classList.toggle('on', on);
    tog.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  const hide = $('chartHideBtn'), show = $('chartShowBtn');
  if (hide){
    hide.disabled = !on;
    if (!on && from === hide) hide.blur();
  }
  if (show){
    show.hidden = on;
    show.setAttribute('aria-expanded', on ? 'true' : 'false');
    /* фокус передаём видимой кнопке, иначе с клавиатуры путь к графикам теряется */
    if (!on && from === hide) show.focus();
    if (on && from === show && hide) hide.focus();
  }
  if (on) setTimeout(() => { resizeCharts(); updateChart(); }, 60);
  if (o.remember !== false){
    try { localStorage.setItem(CHARTS_KEY, on ? '1' : '0'); } catch(e){}
  }
}

const LAYOUT_KEY = 'ges_layout_v1';
/* окна, помнящие своё место; statusBar — только позицию (см. moveOnly) */
const WINDOWS = ['sidebar', 'chartPanel', 'statusBar'];
const NARROW = () => window.matchMedia && window.matchMedia('(max-width:900px)').matches;

function saveLayout(id, box){
  try {
    const all = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    all[id] = box;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch(e){}
}
function readLayout(){
  try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); } catch(e){ return {}; }
}
function clearLayout(id){
  try {
    const all = readLayout();
    delete all[id];
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch(e){}
}
function clampBox(el, box){
  const W = window.innerWidth, H = window.innerHeight;
  /* moveOnly — элементы с размером «по содержимому» (статус): их нельзя ни
     растягивать по сохранённой ширине, ни обрезать половиной за краем */
  if (box.moveOnly){
    const w = Math.min(box.w || el.offsetWidth, W - 16);
    const h = Math.min(box.h || el.offsetHeight, H - 16);
    return Object.assign({}, box, {
      w, h,
      left: Math.max(8, Math.min(box.left, W - w - 8)),
      top:  Math.max(8, Math.min(box.top,  H - h - 8))
    });
  }
  const w = Math.min(Math.max(box.w || el.offsetWidth, 220), W - 16);
  const h = Math.min(Math.max(box.h || el.offsetHeight, 140), H - 16);
  return {
    w, h,
    left: Math.max(8 - w * 0.5, Math.min(box.left, W - w - 8 + w * 0.5)),
    top:  Math.max(8 - h * 0.5, Math.min(box.top,  H - 24))
  };
}
function applyLayout(id, el, box){
  el.style.position = 'absolute';
  el.style.right = 'auto'; el.style.bottom = 'auto';
  el.style.left = Math.round(box.left) + 'px';
  el.style.top  = Math.round(box.top) + 'px';
  if (box.moveOnly){
    /* только координаты: ширина/высота остаются вычисленными браузером, иначе
      .statusText в статус-окне обрезался бы до записанных когда-то пикселей */
    el.style.width = ''; el.style.height = '';
    return;
  }
  el.style.width = Math.round(box.w) + 'px';
  el.style.height = Math.round(box.h) + 'px';
  /* таймлайн подстроен под ширину сайдбара через CSS-переменную */
  if (id === 'sidebar') document.documentElement.style.setProperty('--rail', Math.round(box.w) + 'px');
}

const isButton = el => !!(el && el.closest && el.closest('button'));

function makeDraggable(id, handleSelector, opts){
  const o = opts || {};
  const el = $(id);
  if (!el) return;
  const handle = handleSelector ? el.querySelector(handleSelector) : el;
  if (!handle) return;

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || NARROW()) return;      // на узких экранах панели — ящики
    if (isButton(e.target)) return;              // ✕ в шапке — не ручка перетаскивания
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    el.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);

    const move = ev => {
      const W = window.innerWidth, H = window.innerHeight;
      const left = Math.min(Math.max(ev.clientX - dx, 8 - r.width * 0.4), W - r.width * 0.6);
      const top  = Math.min(Math.max(ev.clientY - dy, 8), H - 48);
      el.style.position = 'absolute';
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      if (!o.moveOnly){
        el.style.width = r.width + 'px';
        el.style.height = r.height + 'px';
      }
    };
    const up = () => {
      el.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      const box = el.getBoundingClientRect();
      const c = clampBox(el, { left: box.left, top: box.top, w: box.width, h: box.height,
                                moveOnly: !!o.moveOnly });
      applyLayout(id, el, c);
      saveLayout(id, c);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  /* двойной клик по заголовку — вернуть панель на место (единственный
     «escape hatch», кроме ⟳, который раньше был только через reload) */
  handle.addEventListener('dblclick', e => {
    if (isButton(e.target)) return;              // двойной клик по ✕ — не «вернуть окно»
    clearLayout(id);
    el.style.position = ''; el.style.left = ''; el.style.top = '';
    el.style.width = ''; el.style.height = ''; el.style.right = ''; el.style.bottom = '';
    if (id === 'sidebar') document.documentElement.style.removeProperty('--rail');
    if (S.chartPower) S.chartPower.resize();
    if (S.chartLevel) S.chartLevel.resize();
  });
}

function makeResizable(id, minW = 220, minH = 150){
  const el = $(id);
  if (!el) return;
  ['tl','tr','bl','br'].forEach(pos => {
    const grip = document.createElement('div');
    grip.className = 'resizer ' + pos;
    grip.setAttribute('aria-hidden', 'true');
    el.appendChild(grip);
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || NARROW()) return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      grip.setPointerCapture(e.pointerId);

      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        let { left, top, width, height } = { left:r.left, top:r.top, width:r.width, height:r.height };
        if (pos.includes('r')) width  = Math.max(minW, r.width + dx);
        if (pos.includes('l')) { width = Math.max(minW, r.width - dx); left = r.right - width; }
        if (pos.includes('b')) height = Math.max(minH, r.height + dy);
        if (pos.includes('t')) { height = Math.max(minH, r.height - dy); top = r.bottom - height; }
        applyLayout(id, el, { left, top, w: width, h: height });
        if (S.chartPower) S.chartPower.resize();
        if (S.chartLevel) S.chartLevel.resize();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        const box = el.getBoundingClientRect();
        const c = clampBox(el, { left: box.left, top: box.top, w: box.width, h: box.height });
        applyLayout(id, el, c);
        saveLayout(id, c);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  });
}

function restoreWindows(){
  const saved = readLayout();
  WINDOWS.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.querySelectorAll('.resizer').forEach(r => r.remove());
    if (NARROW()){
      el.style.position = ''; el.style.left = ''; el.style.top = '';
      el.style.width = ''; el.style.height = '';
      return;
    }
    const box = saved[id];
    if (box) applyLayout(id, el, clampBox(el, box));
  });
}

function makeWindowsDraggable(){
  restoreWindows();
  makeDraggable('sidebar', '.drag-handle');
  makeResizable('sidebar', 240, 240);
  makeDraggable('chartPanel', '.drag-handle');
  makeResizable('chartPanel', 280, 180);
  /* статус-окно: двигаем, но не ресайзим (moveOnly) — размер у него по тексту */
  makeDraggable('statusBar', null, { moveOnly:true });
  /* смена размера окна / поворот телефона — пересобрать раскладку */
  let t = 0;
  /* масштаб поменялся — лента прорыва пересчитывается (её пол видимости
     привязан к зуму); без этого пунктир зоны остаётся «с того» масштаба */
  map.on('zoomend', () => { if (S.damBreak && S.damBreak.redrawBand) S.damBreak.redrawBand(); });
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { restoreWindows(); map.invalidateSize(); }, 180);
  });
}

/* Глобальные обработчики, которые не привязаны к конкретной панели */
function bindGlobalHandlers(){
  /* «Паспорт и график →» внутри leaflet-попапа: содержимое попапа пересоздаётся,
     поэтому вешать handler на кнопку нельзя — только делегирование на document */
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.popMore');
    if (!btn) return;
    const box = $('details');
    box.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block:'nearest' });
    const item = hppRow(btn.dataset.id);
    if (item) item.focus();
  });

  /* Пробел — плей/пауза, если фокус не в поле ввода; Esc уже закрыт в buildUI */
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.code === 'Space' && !e.target.closest('button')){
      e.preventDefault();
      togglePlay();
    }
  });
}

(async function boot(){
  buildUI();
  makeWindowsDraggable();
  bindGlobalHandlers();
  try { await loadPeriod('history'); }
  catch(e){ console.error('Ошибка:', e); setStatus('<span class="err">ошибка: '+e.message+'</span>'); }
})();
