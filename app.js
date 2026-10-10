/* ============================================================
   ПАСПОРТНЫЕ ДАННЫЕ ГЭС
   flowDir — направление течения вниз по реке (0=С, 90=В, 180=Ю).
   ============================================================ */
const HPPS = [
  /* Новые ГТС Северного Кавказа (данные: РусГидро/Википедия + проектная таблица).
     Гизельдонская: координаты плотины у завала Кахты-Сар; напор 289 м — деривационный.
     Баксанская: координаты головного узла (волна от водосливной плотины). */
  {id:'giz', name:'Гизельдонская ГЭС', river:'Гизельдон', lat:42.8785, lon:44.4503, flowDir:15,
   capacityMW:22.8, head:289, nmu:1176, umo:1175.73, areaNMU:10.81, totalVolume:0.015, usefulVolume:0.00293,
   eff:.85, year:1934, terrainAmpl:800, reservoirName:'Гизельдонское',
   resCoords:'42°52′34″ N, 44°26′57″ E',
   damH:21.5, breachW:100, chanW0:30, chanW1:140,
   damType:'грунтовая каменно-набросная, 21,5 м'},
  {id:'gun', name:'Гунибская ГЭС им. Р. Гамзатова', river:'Каракойсу', lat:42.4317, lon:46.9869, flowDir:5,
   capacityMW:15, head:110, nmu:863.5, umo:862, areaNMU:0.6, totalVolume:0.01058, usefulVolume:0.00087,
   eff:.93, year:2005, terrainAmpl:600, reservoirName:'Гунибское',
   resCoords:'42°25′13″ N, 46°58′44″ E',
   damH:73.3, breachW:45, chanW0:40, chanW1:200,
   damType:'бетонная арочная с пробкой, 73,3 м'},
  {id:'bak', name:'Баксанская ГЭС', river:'Баксан', lat:43.6056, lon:43.3056, flowDir:76,
   capacityMW:27, head:88.53, nmu:647.2, umo:645, areaNMU:0.072, totalVolume:0.00016, usefulVolume:0.00015,
   eff:.93, year:1936, terrainAmpl:900, reservoirName:'Деривационный канал Баксанской ГЭС',
   damH:6, breachW:55, chanW0:40, chanW1:180,
   damType:'бетонная водосливная, ≈6 м'}
];

const PRIORITY = ['giz', 'gun', 'bak'];
const HISTORY_START = '2023-01-01';
const CHART_WINDOW = 60;
const CHART_THROTTLE_MS = 80;

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
  .setView([43.15, 44.95], 8);
L.control.attribution({ position:'bottomright', prefix: false }).addTo(map);

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

/* Панорама так, чтобы станция оказалась НЕ под панелями: точка ставится
   на 62% ширины экрана (левее chart-панели, правее сайдбара). */
function panToStation(h, zoom){
  const z = Math.max(map.getZoom(), zoom || 7);
  const pt = map.project([h.lat, h.lon], z);
  const sz = map.getSize();
  const center = map.unproject(pt.subtract([(0.62 - 0.5) * sz.x, 0]), z);
  map.flyTo(center, z, { duration: 0.7 });
}

/* Минимальная ЭКРАННАЯ ширина волны/зоны: на обзорном масштабе (z≈8-10,
   ~450 м/пикс) реальная лента 100-500 м тоньше пикселя и невидима. */
function visWidths(w, floor){
  const out = new Float32Array(w.length);
  for (let k = 0; k < w.length; k++) out[k] = w[k] > 1 ? Math.max(w[k], floor) : 0;
  return out;
}

/* ============================================================
   СОСТОЯНИЕ
   ============================================================ */
const S = {
  mode:'history', scenario:'normal',
  dates:[], results:{}, cache:{}, sources:{},
  markers:{}, reservoirs:{},
  idx:0, playing:false, selected:null, chart:null,
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

function showStatusMsg(msg){
  const el = $('statusText');
  const prev = el.innerHTML;
  el.innerHTML = '<span class="warn">' + msg + '</span>';
  setTimeout(() => { el.innerHTML = prev; }, 3000);
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

function readCacheAll(){ try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');}catch(e){return{};} }
function writeCacheAll(o){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(o)); }
  catch(e){
    try {
      const keys = Object.keys(o);
      if (keys.length > 1){ delete o[keys[0]]; localStorage.setItem(CACHE_KEY, JSON.stringify(o)); }
      else localStorage.removeItem(CACHE_KEY);
    } catch(_){}
  }
}
function getCached(mode,id){
  const a=readCacheAll(); const e=a[mode]?.[id];
  if(!e) return null;
  if(Date.now()-e.ts > TTL[mode]) return null;
  return e.data;
}
function getStaleCached(mode,id){
  const a=readCacheAll(); const e=a[mode]?.[id];
  return e ? e.data : null;
}
function compressData(data){
  return {
    hydro: { time: data.hydro.time, q: data.hydro.q.map(v => v==null?null:Math.round(v)) },
    clim: { time: data.clim.time,
      t: data.clim.t.map(v => v==null?null:Math.round(v*10)/10),
      p: data.clim.p.map(v => v==null?null:Math.round(v*10)/10) }
  };
}
function setCached(mode,id,data){
  const a=readCacheAll(); if(!a[mode]) a[mode]={};
  a[mode][id]={ ts:Date.now(), data: compressData(data) };
  writeCacheAll(a);
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
   вернулась, автоматически докачиваем данные текущего режима. */
let offlineRetryTimer = null;
function ensureOfflineRetry(){
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
function syntheticData(h, mode){
  let start, end;
  if (mode === 'history'){ start=new Date(HISTORY_START); end=new Date(Date.now()-8*864e5); }
  else if (mode === 'forecast'){ start=new Date(Date.now()-30*864e5); end=new Date(Date.now()+16*864e5); }
  else { start=new Date('2025-01-01'); end=new Date('2030-12-31'); }

  const times=[], qs=[], ts=[], ps=[];
  const QmaxT = h.capacityMW*1e6/(1000*9.81*h.head*h.eff);
  const Qmean = 0.4*QmaxT;
  const seed = h.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
  const latF = Math.min(1, Math.abs(h.lat-45)/20);

  for (let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
    times.push(d.toISOString().slice(0,10));
    const doy = Math.floor((d - new Date(d.getFullYear(),0,0))/864e5);
    const ang = (doy/365.25)*2*Math.PI;
    const spring = Math.exp(-Math.pow((doy-130)/45,2));
    const noise = 0.85 + 0.3*Math.sin(ang*7+seed) + 0.15*Math.sin(ang*23+seed*2);
    qs.push(Math.max(50, Qmean*(0.35 + 1.4*spring)*noise));
    ts.push(5 + latF*3 + (13+latF*5)*Math.sin(ang - Math.PI/2 - 0.2) + 1.5*Math.sin(ang*5+seed));
    ps.push(Math.max(0, 1.8 + 1.2*Math.sin(ang+1) + 0.6*Math.sin(ang*6+seed)));
  }
  return { hydro:{time:times,q:qs}, clim:{time:times,t:ts,p:ps} };
}

async function fetchFromAPI(h, mode){
  if (mode === 'history'){
    const start = HISTORY_START;
    const end = new Date(Date.now()-8*864e5).toISOString().slice(0,10);
    const [a,f] = await Promise.all([
      fetchWithRetry(`https://archive-api.open-meteo.com/v1/archive?latitude=${h.lat}&longitude=${h.lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_mean,precipitation_sum&timezone=UTC`),
      fetchWithRetry(`https://flood-api.open-meteo.com/v1/flood?latitude=${h.lat}&longitude=${h.lon}&daily=river_discharge&start_date=${start}&end_date=${end}`)
    ]);
    return { hydro:{time:f.daily.time, q:f.daily.river_discharge},
             clim:{time:a.daily.time, t:a.daily.temperature_2m_mean, p:a.daily.precipitation_sum} };
  }
  if (mode === 'forecast'){
    const [a,f] = await Promise.all([
      fetchWithRetry(`https://api.open-meteo.com/v1/forecast?latitude=${h.lat}&longitude=${h.lon}&daily=temperature_2m_mean,precipitation_sum&past_days=30&forecast_days=16&timezone=UTC`),
      fetchWithRetry(`https://flood-api.open-meteo.com/v1/flood?latitude=${h.lat}&longitude=${h.lon}&daily=river_discharge&past_days=30&forecast_days=16`)
    ]);
    return { hydro:{time:f.daily.time, q:f.daily.river_discharge},
             clim:{time:a.daily.time, t:a.daily.temperature_2m_mean, p:a.daily.precipitation_sum} };
  }
  if (mode === 'climate'){
    const a = await fetchWithRetry(
      `https://climate-api.open-meteo.com/v1/climate?latitude=${h.lat}&longitude=${h.lon}&start_date=2025-01-01&end_date=2030-12-31&models=MRI_AGCM3_2_S&daily=temperature_2m_mean,precipitation_sum`, 25000);
    const t = a.daily.temperature_2m_mean_MRI_AGCM3_2_S || a.daily.temperature_2m_mean;
    const p = a.daily.precipitation_sum_MRI_AGCM3_2_S || a.daily.precipitation_sum;
    const QmaxT = h.capacityMW*1e6/(1000*9.81*h.head*h.eff);
    const Qmean = 0.4*QmaxT;
    const valid = p.filter(v => v != null);
    const Pmean = valid.length ? valid.reduce((s,v)=>s+v,0)/valid.length : 2;
    const q = p.map(P => Math.max(0, Qmean*(0.4 + 0.8*(P||0)/Math.max(0.1,Pmean))));
    return { hydro:{time:a.daily.time, q}, clim:{time:a.daily.time, t, p} };
  }
  throw new Error('unknown mode');
}

async function loadStation(h, mode){
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
   МОДЕЛЬ
   ============================================================ */
function simulate(h, hydro, clim){
  const dh = h.nmu - h.umo;
  const A0 = h.areaNMU * 1e6;
  const Vd = (h.totalVolume - h.usefulVolume) * 1e9;
  const p1 = Math.max(0.6, A0*dh/(h.usefulVolume*1e9));
  const p = p1 - 1;
  const VofX = x => Vd + A0*dh*Math.pow(x,p1)/p1;
  const AofX = x => A0*Math.pow(Math.max(x,1e-6),p);
  const xOfV = v => Math.pow(Math.max(1e-6, v-Vd)*p1/(A0*dh), 1/p1);
  const QmaxT = h.capacityMW*1e6/(1000*9.81*h.head*h.eff);
  const tailBase = h.nmu - h.head;
  const n = hydro.q.length;
  const out = { level:[], area:[], power:[], flow:[], spill:[], head:[], lf:[], kwh:0 };
  const cs = new Float64Array(n+1);
  for (let i=0;i<n;i++) cs[i+1] = cs[i] + (hydro.q[i]||0);
  const WIN = 60;
  const trail = i => { const a=Math.max(0,i-WIN), b=i+1; return (cs[b]-cs[a])/(b-a); };
  const targetX = 0.62;
  let vol = VofX(targetX);
  for (let i=0;i<n;i++){
    const x = Math.min(1, Math.max(1e-6, xOfV(vol)));
    const level = h.umo + x*dh;
    const area = AofX(x);
    const T = clim.t[i] ?? 8;
    const Pr = clim.p[i] ?? 0;
    const Qevap = Math.max(0, 0.12*(T+2))/1000*area/86400;
    const Qrain = Pr/1000*area/86400;
    const Qnet = Math.max(0, hydro.q[i]||0) + Qrain - Qevap;
    const Qbase = trail(i);
    const err = level - (h.umo + targetX*dh);
    let Qrel = Math.max(0, Qbase + err*area/(20*86400));
    const tw = tailBase + 1.6*Math.pow(Math.min(1.2, Qrel/(QmaxT+1)), 0.5);
    const headNet = Math.max(2, (level-tw)*0.97);
    const Qcap = QmaxT * Math.min(1.15, Math.sqrt(h.head/Math.max(5,headNet)));
    let Qt = Math.min(Qrel, Qcap);
    let Qsp = Math.max(0, Qrel - Qt);
    if (level < h.nmu - 0.5) Qsp = 0;
    let volNew = vol + (Qnet - Qt - Qsp)*86400;
    if (volNew > VofX(1)){ Qsp += (volNew - VofX(1))/86400; volNew = VofX(1); }
    if (volNew < VofX(0.02)) volNew = VofX(0.02);
    vol = volNew;
    const qr = Math.min(1, Qt/QmaxT);
    const etaPart = 1 - 0.30*Math.pow(1-qr, 2);
    const ice = T < -5 ? 0.98 : 1;
    let P = 1000*9.81*Qt*headNet*h.eff*etaPart*ice/1e6;
    P = Math.min(P, h.capacityMW);
    out.kwh += P*24;
    out.level.push(level); out.area.push(area/1e6);
    out.power.push(P); out.flow.push(Qt+Qsp); out.spill.push(Qsp);
    out.head.push(headNet); out.lf.push(P/h.capacityMW);
  }
  out.p1 = p1;
  return out;
}

function recompute(){
  HPPS.forEach(h => {
    const c = S.cache[S.mode]?.[h.id];
    if (!c){ delete S.results[h.id]; return; }
    let q = c.hydro.q;
    if (S.scenario === 'flood'){
      const i = S.idx;
      q = q.map((v,k) => (v||0) * (1 + 5*Math.exp(-(k-i)*(k-i)/400)));
    } else if (S.scenario === 'drought'){
      q = q.map(v => (v||0) * 0.15);
    }
    S.results[h.id] = simulate(h, { time:c.hydro.time, q }, c.clim);
    if (S.scenario === 'dam_break' && S.selected === h.id){
      const r = S.results[h.id];
      for (let k=0;k<r.power.length;k++){
        r.power[k]=0; r.lf[k]=0; r.spill[k]=r.flow[k]; r.flow[k]=0;
      }
    }
  });
}

/* ============================================================
   МАРКЕРЫ
   ============================================================ */
function createMarker(h){
  const mk = L.circleMarker([h.lat, h.lon], {
    radius: 8, color:'#ffffff', weight: 2.5,
    fillColor:'#888', fillOpacity: 1, opacity: 1
  }).addTo(layerMarkers);
  mk.on('click', () => selectHPP(h.id, false));
  mk.bindTooltip(h.name, { direction:'top', offset:[0,-8] });
  S.markers[h.id] = mk;
  return mk;
}

/* ============================================================
   ТАЙМЛАЙН
   ============================================================ */
function updateTimeline(mode){
  const sl = $('slider');
  sl.max = S.dates.length - 1;
  S.idx = Math.floor(S.dates.length / 2);
  sl.value = S.idx;
  const n = S.dates.length;
  const fmt = d => mode === 'history' ? d.slice(0,4) : d.slice(0,7);
  $('tickA').textContent = fmt(S.dates[0]);
  $('tickB').textContent = fmt(S.dates[Math.floor(n/2)]);
  $('tickC').textContent = fmt(S.dates[n-1]);
}

/* ============================================================
   ЗАГРУЗКА ПЕРИОДА
   ============================================================ */
async function loadPeriod(mode){
  if (S.loading) return;
  S.loading = true;

  S.results = {}; S.idx = 0; S.playing = false; S.damBreak = null; S.dates = [];
  S.cache[mode] = {}; S.sources = {}; S.loadingStation = {};

  clear(layerFlood);
  clear(layerRes);
  S.reservoirs = {};
  $('playBtn').textContent = '▶';

  HPPS.forEach(h => {
    const item = document.querySelector(`.hppItem[data-id="${h.id}"]`);
    if (!item) return;
    item.querySelector('.src').className = 'src loading';
    item.querySelector('.mw').textContent = '…';
  });
  setStatus(`<span class="warn">загрузка</span> · ${mode}`);

  let fromCache = 0;
  HPPS.forEach(h => {
    const cached = getCached(mode, h.id);
    if (cached){
      S.cache[mode][h.id] = cached;
      S.sources[h.id] = 'cache';
      S.results[h.id] = simulate(h, cached.hydro, cached.clim);
      fromCache++;
      const item = document.querySelector(`.hppItem[data-id="${h.id}"]`);
      if (item){
        item.querySelector('.src').className = 'src cache';
        item.querySelector('.mw').textContent = h.capacityMW + ' МВт';
      }
    }
  });

  if (fromCache){
    const first = HPPS.find(h => S.cache[mode][h.id]);
    if (first){
      S.dates = S.cache[mode][first.id].hydro.time;
      updateTimeline(mode);
      recompute(); render();
    }
  }

  if (apiAvailable !== true) await pingAPI();

  const missing = HPPS.filter(h => !S.cache[mode][h.id]);
  missing.sort((a,b) => {
    const ai = PRIORITY.indexOf(a.id), bi = PRIORITY.indexOf(b.id);
    return (ai<0?999:ai) - (bi<0?999:bi);
  });

  if (!apiAvailable && !missing.length){
    setStatus(`<b>${mode}</b> · <span class="warn">🟡 ${fromCache} из кэша (офлайн)</span>`);
    S.loading = false;
    return;
  }

  /* Фоновая ревалидация: кэш показываем мгновенно, но если он старше
     порога — молча докачиваем свежие данные и обновляем отображение. */
  const REVALIDATE_MS = { history: 3600e3, forecast: 10*60e3, climate: 24*3600e3 };
  let stale = [];
  if (apiAvailable){
    const all = readCacheAll();
    const now = Date.now();
    stale = HPPS.filter(h => {
      if (!S.cache[mode][h.id]) return false;
      const e = all[mode]?.[h.id];
      return e && (now - e.ts > REVALIDATE_MS[mode]);
    });
  }

  const queue = [...missing, ...stale];
  let done = 0, countApi = 0, countSynth = 0;

  async function worker(){
    while (queue.length){
      const h = queue.shift();
      if (S.loadingStation[h.id]) continue;
      S.loadingStation[h.id] = true;
      const { data, source } = await loadStation(h, mode);
      S.cache[mode][h.id] = data;
      S.sources[h.id] = source;
      S.results[h.id] = simulate(h, data.hydro, data.clim);
      delete S.loadingStation[h.id];

      if (source === 'api') countApi++;
      else countSynth++;

      const item = document.querySelector(`.hppItem[data-id="${h.id}"]`);
      if (item){
        item.querySelector('.src').className = 'src ' + source;
        item.querySelector('.mw').textContent = h.capacityMW + ' МВт';
      }

      if (!S.dates.length){
        S.dates = data.hydro.time;
        updateTimeline(mode);
      }
      recompute(); render();

      done++;
      setStatus(`<span class="warn">докачка</span> · ${done}/${queue.length}`);
      await sleep(120);
    }
  }
  await Promise.all([worker(), worker(), worker()]);

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
  setStatus(`<b>${mode}</b> · ${parts.join(' · ')}`);
  S.loading = false;
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
  return base;
}

function makeBandPolygon(centerline, widths, latRef){
  const R = 6371000;
  const latR = latRef*Math.PI/180;
  const degLat = 180/(Math.PI*R);
  const degLon = 180/(Math.PI*R*Math.cos(latR));
  const n = centerline.length;
  const maxW = Math.max(...widths, 1);

  /* Линия после Chaikin имеет шаг ~60 м. Если смещать её на ширину в
     километры напрямую, любой поворот даёт самопересечение ("бабочку").
     Поэтому для построения ленты используем СГЛАЖЕННУЮ центральную линию:
     окно скользящего среднего ~55% максимальной ширины — кривизна
     становится мягче полуширины и лента не складывается. */
  let segSum = 0;
  for (let i=1;i<n;i++){
    segSum += Math.hypot(
      (centerline[i][0]-centerline[i-1][0])/degLat,
      (centerline[i][1]-centerline[i-1][1])/degLon);
  }
  const segAvg = Math.max(10, segSum/Math.max(1, n-1));
  const winPts = Math.max(3, Math.round((maxW * 0.55) / segAvg));

  const sm = new Array(n);
  const halfW2 = Math.floor(winPts/2);
  for (let i=0;i<n;i++){
    const a = Math.max(0, i-halfW2), b = Math.min(n-1, i+halfW2);
    let la=0, lo=0;
    for (let j=a;j<=b;j++){ la+=centerline[j][0]; lo+=centerline[j][1]; }
    const c = b-a+1;
    sm[i] = [la/c, lo/c];
  }

  const left = [], right = [];
  for (let i=0;i<n;i++){
    let dLat, dLon;
    if (i===0){ dLat=sm[1][0]-sm[0][0]; dLon=sm[1][1]-sm[0][1]; }
    else if (i===n-1){ dLat=sm[i][0]-sm[i-1][0]; dLon=sm[i][1]-sm[i-1][1]; }
    else { dLat=sm[i+1][0]-sm[i-1][0]; dLon=sm[i+1][1]-sm[i-1][1]; }
    const dxM = dLon/degLon, dyM = dLat/degLat;
    const lenM = Math.hypot(dxM, dyM) || 1;
    const nxM = -dyM/lenM, nyM = dxM/lenM;

    const halfW = Math.max(15, (widths[i] ?? widths[widths.length-1])/2);
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
  let trimmed = trimCourse(course, frontLen);
  if (trimmed.length < 2) return null;
  trimmed = chaikinSmooth(trimmed, 2);
  const n = trimmed.length;
  const W = params.maxWidth * ramp * (0.45 + 0.55 * decay);
  const widths = trimmed.map((_, i) => {
    const s = n > 1 ? i/(n-1) : 0;             // 0 — плотина, 1 — фронт
    const taper = 1 - 0.6 * Math.pow(s, 0.85); // затухание к переднему краю
    const snout = s > 0.88 ? 0.25 + 0.75*(1-s)/0.12 : 1; // острый нос
    const startRamp = s < 0.04 ? 0.25 + 0.75*s/0.04 : 1; // сужение у плотины (без «воротника»)
    return Math.max(10, W * taper * snout * startRamp);
  });
  const pts = makeBandPolygon(trimmed, widths, h.lat);
  return { pts, params, front: trimmed[n-1], decay };
}

/* Максимальный охват затопления: лента по ВСЕЙ достижимой части русла
   без запуска/затухания — то, что волна в итоге зальёт. Рисуется один
   раз под движущейся волной бледным слоем «зона затопления». */
function makeFloodFootprint(h, course){
  const params = getWaveParams(h);
  let trimmed = chaikinSmooth(course, 2);
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
  return { pts: makeBandPolygon(trimmed, widths, h.lat), params };
}

/* ============================================================
   ФИЗИЧЕСКАЯ МОДЕЛЬ ПРОРЫВА ПЛОТИНЫ (1D)
   Уравнения мелкой воды (Сен-Венана) вдоль реального русла:
     ∂A/∂t + ∂Q/∂x = 0
     ∂Q/∂t + ∂(Q²/A + gA²/2B̄)/∂x = −gA·dz/∂x − g·n²·Q|Q|·A/(A·R^{4/3})
   Канал — трапеция (B(s) по дну, откос m=1:18), шероховатость Мэннинга
   n=0.035 (горный галечник). Профиль дна — реальный (SRTM/DEM, встроен).
   Граничное условие на створе — водослив широкого порога с формированием
   прорана за ~20 мин и опорожнением водохранилища (баланс объёма).
   Схема Годунова с потоком Гуно (HLL), адаптивный шаг по Куранту;\n   сухое дно обрабатывается корректно (переход мокрое/сухое).
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

  const g = 9.81, nM = 0.04, mSide = 6;   /* откосы стенок каньона 1:6 — только для показа ширины */
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
        wArr[k] = Hd[k] > 0.05 ? Math.min(wCell[k] + 2*mSide*Hd[k], Math.max(wCell[k]*3.5, 500)) : 0;
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
  return { line, ds, N, L, frames, maxW, simT: t, H0eff,
           frontKm: lastF.front*ds/1000,
           physInfo: `H₀=${H0eff.toFixed(0)} м, Мэннинг n=0.04` };
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

  /* ========= ФИЗИЧЕСКИЙ РЕЖИМ: уравнения Сен-Венана по реальному профилю ======== */
  const elev = (typeof RIVER_ELEV !== 'undefined') ? RIVER_ELEV[h.id] : null;
  if (elev && elev.length >= 10){
    showStatusMsg('Расчёт прорыва: Сен-Венан 1D по профилю DEM…');
    await sleep(30);
    const sim = simulateDamBreak(h, course, elev);
    if (!sim.frames.length){ showStatusMsg('Модель не дала волны'); return; }

    /* Зона затопления = размах затопленной ширины за весь расчёт
       (обрезаем по реально достигнутому фронту — без «нитки» до конца курса) */
    let maxK = sim.N;
    while (maxK > 1 && sim.maxW[maxK] < 1) maxK--;
    maxK = Math.max(maxK, 2);
    const footPts = makeBandPolygon(
      chaikinSmooth(sim.line.slice(0, maxK + 1), 1),
      Array.from(visWidths(sim.maxW.slice(0, maxK + 1), 500)), h.lat);

    /* перенос и зум на зону прорыва, чтобы волну было видно */
    const seg = sim.line.slice(0, maxK + 1);
    const la = seg.map(p => p[0]), lo = seg.map(p => p[1]);
    map.flyToBounds(
      [[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]],
      { paddingTopLeft: [370, 90], paddingBottomRight: [450, 120], duration: 0.7 });
    polyAdd(layerFloodZone, footPts, {
      color:'#ff9400', weight:1.5, opacity:0.85, dash:true,
      fill:'#ffa726', fillOpacity:0.20
    });

    const realDur = Math.min(60, Math.max(20, sim.simT / 240));
    const fmtT = s => {
      const m2 = Math.floor(s/60), h2 = Math.floor(m2/60);
      return (h2 ? h2 + 'ч ' : '') + (m2 % 60) + 'м';
    };
    S.damBreak = { id:h.id, progress:0, start:performance.now(), duration: realDur, course };
    $('alertBanner').classList.add('show');
    recompute(); render();
    $('details').innerHTML = detailsHTML(h);
    /* попап «💥 ПЛОТИНА РАЗРУШЕНА» у плотины — после начала анимации */
    setTimeout(() => { const m = S.markers[h.id]; if (m) m.openPopup(); }, 500);

    let fi = 0;
    function step(tNow){
      if (!S.damBreak) return;
      const elapsed = (tNow - S.damBreak.start) / 1000;
      const tSim = Math.min(sim.simT, elapsed * (sim.simT / realDur));
      S.damBreak.progress = Math.min(1, tSim / sim.simT);
      while (fi < sim.frames.length - 1 && sim.frames[fi+1].t <= tSim) fi++;
      const fr = sim.frames[fi];
      clear(layerFlood);
      const upto = Math.min(sim.N, fr.front + 2);
      if (upto > 1){
        const lineTrim = sim.line.slice(0, upto + 1);
        const wTrim = Array.from(visWidths(fr.w.slice(0, upto + 1), 500));
        const pts = makeBandPolygon(chaikinSmooth(lineTrim, 1), wTrim, h.lat);
        const depth = Math.min(1, fr.hmax / 15);
        polyAdd(layerFlood, pts, {
          color:'#ff3b3b', weight:1.5, opacity:0.85,
          fill:'#ff5a5a', fillOpacity:0.26 + 0.22*depth
        });
        try {
          L.circleMarker(sim.line[upto], {
            radius: 6, color:'#ff1a1a', weight:2.5, opacity:0.95,
            fillColor:'#ff5a5a', fillOpacity:0.9, interactive:false
          }).addTo(layerFlood);
        } catch(e){ console.warn('front circle:', e.message); }
      }
      $('alertBanner').innerHTML =
        `💥 ПРОРЫВ · Сен-Венан 1D · t+${fmtT(fr.t)} · фронт ${(fr.front*sim.ds/1000).toFixed(1)} км` +
        ` · глубина до ${fr.hmax.toFixed(1)} м · Q прорана ${fr.qsrc.toFixed(0)} м³/с` +
        (fr.pool > 0.05 ? ` · вдхр −${(sim.H0eff - fr.pool).toFixed(1)} м` : ' · вдхр пусто');
      render();
      if (tSim < sim.simT) requestAnimationFrame(step);
      else setTimeout(() => {
        clear(layerFlood);
        clear(layerFloodZone);
        $('alertBanner').classList.remove('show');
        S.damBreak = null;
        $('details').innerHTML = detailsHTML(h);
      }, 2600);
    }
    requestAnimationFrame(step);
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

  setTimeout(() => { const m = S.markers[h.id]; if (m) m.openPopup(); }, 400);
  const duration = Math.max(12, params.baseDuration * 1.25);
  S.damBreak = { id:h.id, progress:0, start:performance.now(), duration, course };
  $('alertBanner').innerHTML = `💥 ПРОРЫВ ПЛОТИНЫ · ${params.type} волна · затопление ${(courseLength(course)/1000).toFixed(0)} км вниз по течению`;
  $('alertBanner').classList.add('show');

  recompute(); render();
  $('details').innerHTML = detailsHTML(h);

  function step(t){
    if (!S.damBreak) return;
    const elapsed = (t - S.damBreak.start)/1000;
    S.damBreak.progress = Math.min(1, elapsed / S.damBreak.duration);
    clear(layerFlood);

    const wave = makeFloodWaveFromCourse(h, course, S.damBreak.progress);
    if (wave){
      const fade = wave.decay;
      polyAdd(layerFlood, wave.pts, {
        color:'#ff3b3b', weight:1.5, opacity:0.8*fade + 0.1,
        fill:'#ff5a5a', fillOpacity:0.30*fade
      });
      if (wave.decay > 0.05){
        try {
          L.circleMarker(wave.front, {
            radius: 4 + 4*wave.decay, color:'#ff1a1a', weight:2.5, opacity:0.95*fade,
            fillColor:'#ff5a5a', fillOpacity:0.9*fade, interactive:false
          }).addTo(layerFlood);
        } catch(e){ console.warn('front:', e.message); }
      }
    }
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
  S.damBreak = null;
  clear(layerFlood);
  clear(layerFloodZone);
  $('alertBanner').classList.remove('show');
}

/* ============================================================
   ВОДОХРАНИЛИЩЕ (с фолбэком-эллипсом)
   ============================================================ */
function drawReservoir(h, i, lf, overtop){
  if (S.reservoirs[h.id]){ layerRes.removeLayer(S.reservoirs[h.id]); delete S.reservoirs[h.id]; }
  const r = S.results[h.id];
  if (!r) return;

  let color, fill, op;
  if (overtop){ color='#ff3b3b'; fill='#ff5252'; op=0.5; }
  else if (lf > 0.75){ color='#16b5ff'; fill='#2fc4ff'; op=0.35; }
  else { color='#16b5ff'; fill='#2fc4ff'; op=0.26; }

  /* Сценарная подсветка: паводок — красный, засуха — жёлтый (контур
     при этом всё равно морфится по вариантам n/d/f чуть ниже). */
  if (S.scenario === 'flood'){ color='#ff2222'; fill='#ff4545'; op=0.45; }
  else if (S.scenario === 'drought'){ color='#ffb300'; fill='#ffd54a'; op=0.4; }

  /* 1) Встроенные реальные контуры (reservoirs-data.js, снимок OSM) — приоритет */
  const g = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
  if (g){
    /* Выбор контура: n — норма, d — засуха (вода отступила), f — паводок (разлив).
       По моделируемой площади зеркала k=A/А_НПУ с гистерезисом против мерцания;
       сценарии паводок/засуха форсируют соответствующий контур. */
    if (!S.resVar) S.resVar = {};
    const k = r.area[i] / h.areaNMU;
    let vi = S.resVar[h.id] ?? 1;
    if (S.scenario === 'drought') vi = (k > 1.05) ? 2 : 0;
    else if (S.scenario === 'flood') vi = (k < 0.5) ? 0 : 2;
    else {
      if (k < 0.55) vi = 0;
      else if (k > 0.62 && k < 1.05) vi = 1;
      else if (k > 1.08) vi = 2;
    }
    S.resVar[h.id] = vi;
    const gn = Array.isArray(g) ? g : (g.n || []);
    const rings = Array.isArray(g) ? g : ([g.d, g.n, g.f][vi] || gn);
    const group = L.layerGroup();
    rings.forEach(ring => {
      polyAdd(group, ring, { color: color, weight:1.6, opacity:0.9, fill: fill, fillOpacity: op });
    });
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

  /* Кнопка ⟳: сбросить кэш данных и перезагрузить страницу за свежими данными */
  $('refreshBtn').onclick = async () => {
    setStatus('очистка кэша…');
    try { localStorage.removeItem(CACHE_KEY); } catch(e){}
    try {
      if ('caches' in window){
        const ks = await caches.keys();
        await Promise.all(ks.map(k => caches.delete(k)));
      }
    } catch(e){}
    location.reload();
  };
  HPPS.forEach(h => {
    const item = document.createElement('div');
    item.className = 'hppItem';
    item.dataset.id = h.id;
    item.innerHTML = `<div class="src loading"></div><div class="nm">${h.name}</div><div class="mw">…</div>`;
    item.onclick = () => selectHPP(h.id, true);
    list.appendChild(item);
    createMarker(h);
  });

  $('slider').oninput = e => { S.idx = +e.target.value; render(); };
  $('playBtn').onclick = togglePlay;

  document.querySelectorAll('.scenBtn').forEach(btn => {
    btn.onclick = () => {
      const sc = btn.dataset.scen;
      document.querySelectorAll('.scenBtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (sc === 'dam_break'){ S.scenario = 'dam_break'; startDamBreak(); }
      else {
        stopDamBreak();
        S.scenario = sc;
        recompute(); render();
        if (S.selected){
          const h = HPPS.find(x => x.id === S.selected);
          $('details').innerHTML = detailsHTML(h);
          updateChart();
        }
      }
    };
  });

  const ctx = $('chart').getContext('2d');
  S.chart = new Chart(ctx, {
    type:'line',
    data:{ labels:[], datasets:[] },
    options:{
      responsive:true, maintainAspectRatio:false, animation:false,
      interaction:{ mode:'index', intersect:false },
      elements:{ point:{ radius:0 } },
      plugins:{
        legend:{ labels:{ color:'#8ba0b6', boxWidth:10, font:{size:10} } },
        tooltip:{ backgroundColor:'rgba(16,22,30,.95)', borderColor:'#2a3644', borderWidth:1,
          titleColor:'#dbe6f2', bodyColor:'#dbe6f2', padding:8 }
      },
      scales:{
        x:{ ticks:{ color:'#6d8199', maxTicksLimit:7, font:{size:9} }, grid:{ color:'rgba(255,255,255,.05)' } },
        y:{ position:'left', ticks:{ color:'#31c9ff', font:{size:9} }, grid:{ color:'rgba(255,255,255,.05)' } },
        y1:{ position:'right', ticks:{ color:'#ffb02e', font:{size:9} }, grid:{ drawOnChartArea:false } }
      }
    }
  });

  document.querySelectorAll('#modeTabs button').forEach(btn => {
    btn.onclick = async () => {
      if (S.loading) return;
      document.querySelectorAll('#modeTabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.mode = btn.dataset.mode;
      stopDamBreak();
      S.scenario = 'normal';
      document.querySelectorAll('.scenBtn').forEach(b => b.classList.toggle('active', b.dataset.scen === 'normal'));
      await loadPeriod(S.mode);
    };
  });
}

/* ============================================================
   РЕНДЕР
   ============================================================ */
function render(){
  const i = S.idx;
  if (!S.dates[i]) return;
  $('dateBox').textContent = S.dates[i].split('-').reverse().join('.');
  $('slider').value = i;

  HPPS.forEach(h => {
    const r = S.results[h.id];
    const mk = S.markers[h.id];
    if (!mk) return;
    if (!r){
      mk.setStyle({ fillColor:'#555', color:'#ffffff', weight:2.5, opacity:0.7, fillOpacity:0.7 });
      return;
    }
    const lf = r.lf[i], lvl = r.level[i];
    const overtop = lvl > h.nmu - 0.15;
    const isBroken = (S.scenario === 'dam_break' && S.selected === h.id);
    let col;
    if (isBroken || overtop) col = '#ff3b3b';
    else col = lf>0.75?'#3ddc84':lf>0.45?'#a8e05f':lf>0.20?'#ffb02e':lf>0.05?'#ff8a3d':'#ff6b6b';
    mk.setStyle({ fillColor: col, color:'#ffffff', weight:2.5, opacity:1, fillOpacity:1 });
    mk.bindPopup(popupHTML(h, r, i, col, isBroken, overtop), { maxWidth: 330 });
  });

  if (S.selected){
    const h = HPPS.find(x => x.id === S.selected);
    const r = S.results[h.id];
    if (r){
      const isBroken = (S.scenario === 'dam_break' && S.selected === h.id);
      if (isBroken){
        if (S.reservoirs[h.id]){ layerRes.removeLayer(S.reservoirs[h.id]); delete S.reservoirs[h.id]; }
      } else {
        drawReservoir(h, i, r.lf[i], r.level[i] > h.nmu - 0.15);
      }
    }
    Object.keys(S.reservoirs).forEach(id => {
      if (id !== S.selected){ layerRes.removeLayer(S.reservoirs[id]); delete S.reservoirs[id]; }
    });
  }

  if (S.selected) updateChart();
}

function popupHTML(h, r, i, col, isBroken, overtop){
  const P = r.power[i], lf = r.lf[i]*100;
  const src = S.sources[h.id];
  const srcLabel = src==='api'?'🟢 онлайн':src==='cache'?'🟡 кэш':'🔴 офлайн';
  const status = isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">💥 ПЛОТИНА РАЗРУШЕНА</div>'
              : overtop ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">⚠ КРИТИЧЕСКИЙ УРОВЕНЬ</div>' : '';
  return `<h4>${h.name}</h4>
  <div style="color:#8ba0b6;margin-bottom:8px">р. ${h.river} · ${h.capacityMW} МВт · ${srcLabel}</div>
  ${status}
  <div class="kv"><span>Мощность</span><span style="color:${col};font-weight:700">${P.toFixed(0)} МВт</span></div>
  <div class="kv"><span>Загрузка</span><span>${lf.toFixed(1)} %</span></div>
  <div class="kv"><span>Уровень ВБ</span><span>${r.level[i].toFixed(2)} м</span></div>
  <div class="kv"><span>Напор</span><span>${r.head[i].toFixed(1)} м</span></div>
  <div class="kv"><span>Расход</span><span>${r.flow[i].toFixed(0)} м³/с</span></div>
  <div class="kv"><span>Сброс</span><span>${r.spill[i].toFixed(0)} м³/с</span></div>
  <div class="kv"><span>Зеркало</span><span>${r.area[i].toFixed(0)} км²</span></div>`;
}

/* ============================================================
   ВЫБОР ГЭС
   ============================================================ */
async function selectHPP(id, fromList){
  S.selected = id;
  const h = HPPS.find(x => x.id === id);
  if (!h) return;

  document.querySelectorAll('.hppItem').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  $('details').innerHTML = detailsHTML(h);
  $('chartPanel').classList.add('show');
  $('chartTitle').textContent = h.name;
  $('chartSub').textContent = `р. ${h.river}`;

  if (map){
    if (fromList) panToStation(h);
    /* попап — после панорамы (Leaflet попапы зум не закрывает, так рисуется чище) */
    setTimeout(() => { const m = S.markers[id]; if (m) m.openPopup(); }, fromList ? 800 : 0);
  }

  if (!S.cache[S.mode]?.[id] && !S.loadingStation[id] && apiAvailable !== false){
    S.loadingStation[id] = true;
    const item = document.querySelector(`.hppItem[data-id="${id}"]`);
    if (item) item.querySelector('.src').className = 'src loading';
    const { data, source } = await loadStation(h, S.mode);
    S.cache[S.mode][id] = data;
    S.sources[id] = source;
    S.results[id] = simulate(h, data.hydro, data.clim);
    delete S.loadingStation[id];
    if (item){
      item.querySelector('.src').className = 'src ' + source;
      item.querySelector('.mw').textContent = h.capacityMW + ' МВт';
    }
    if (!S.dates.length){ S.dates = data.hydro.time; updateTimeline(S.mode); }
    recompute(); render();
  }

  if (!S.riverCourses[h.id] && !S.loadingRiver[h.id]){
    S.loadingRiver[h.id] = loadRiverCourse(h).then(c => {
      S.riverCourses[h.id] = c; delete S.loadingRiver[h.id];
      if (S.selected === h.id) $('details').innerHTML = detailsHTML(h);
      return c;
    }).catch(() => { delete S.loadingRiver[h.id]; });
  }
  const embeddedRes = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
  if (!embeddedRes && !S.reservoirsOSM[h.id] && !S.loadingRes[h.id]){
    S.loadingRes[h.id] = loadReservoirOSM(h).then(p => {
      S.reservoirsOSM[h.id] = p; delete S.loadingRes[h.id];
      if (S.selected === h.id) render();
      return p;
    }).catch(() => { S.reservoirsOSM[h.id] = []; delete S.loadingRes[h.id]; });
  }

  if (S.scenario === 'dam_break') startDamBreak();
  else { updateChart(); render(); }
}

function detailsHTML(h){
  const r = S.results[h.id];
  if (!r) return `<h3>${h.name}</h3><p style="color:#8ba0b6">Данные загружаются…</p>`;
  const i = S.idx;
  const isBroken = (S.scenario === 'dam_break' && S.selected === h.id);
  const overtop = r.level[i] > h.nmu - 0.15;
  const src = S.sources[h.id];
  const srcLabel = src==='api'?'<span style="color:#3ddc84">🟢 свежие данные</span>'
    : src==='cache'?'<span style="color:#ffb02e">🟡 из кэша</span>'
    : '<span style="color:#ff6b6b">🔴 офлайн-режим</span>';
  const wp = getWaveParams(h);
  const course = S.riverCourses[h.id];
  const courseInfo = course
    ? `русло: ${Math.round(courseLength(course)/1000)} км`
    : (S.loadingRiver[h.id] ? 'русло загружается…' : 'русло не загружено');
  const gg = (typeof RESERVOIR_GEOMETRY !== 'undefined') ? RESERVOIR_GEOMETRY[h.id] : null;
  const resEmbedded = !!(gg && (Array.isArray(gg) ? gg.length : (gg.n && gg.n.length)));
  const resInfo = resEmbedded
    ? `водохранилище: реальный контур OSM (встроен)`
    : S.reservoirsOSM[h.id]
      ? (S.reservoirsOSM[h.id].length ? `водохранилище: ${S.reservoirsOSM[h.id].length} объектов OSM` : 'водохранилище: фолбэк')
      : (S.loadingRes[h.id] ? 'водохранилище загружается…' : 'водохранилище: фолбэк');

  return `<h3>${h.name}</h3>
  <div style="font-size:11px;margin-bottom:6px">${srcLabel}</div>
  ${isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">💥 ПЛОТИНА РАЗРУШЕНА</div>' : ''}
  ${overtop && !isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">⚠ КРИТИЧЕСКИЙ УРОВЕНЬ</div>' : ''}
  <div class="kv"><span>Река</span><span>${h.river}</span></div>
  <div class="kv"><span>Водохранилище</span><span>${h.reservoirName || '—'}</span></div>
  ${h.resCoords ? `<div class="kv"><span>Координаты вдхр</span><span>${h.resCoords}</span></div>` : ''}
  <div class="kv"><span>Координаты плотины</span><span>${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}</span></div>
  <div class="kv"><span>Течение (flowDir)</span><span>${h.flowDir}°</span></div>
  <div class="kv"><span>Установленная мощность</span><span>${h.capacityMW} МВт</span></div>
  <div class="kv"><span>Тип плотины</span><span>${h.damType || '—'}</span></div>
  <div class="kv"><span>Расчётный напор</span><span>${h.head} м</span></div>
  <div class="kv"><span>НПУ / УМО</span><span>${h.nmu} / ${h.umo} м</span></div>
  <div class="kv ${overtop?'danger':''}"><span>Текущий уровень</span><span>${r.level[i].toFixed(2)} м</span></div>
  <div class="kv ${overtop?'danger':''}"><span>Текущая мощность</span><span>${r.power[i].toFixed(0)} МВт</span></div>
  <div class="kv"><span>Выработка</span><span>${r.kwh/1e9 >= 0.05 ? (r.kwh/1e9).toFixed(1)+' млрд кВт·ч' : (r.kwh/1e6).toFixed(0)+' млн кВт·ч'}</span></div>
  <div style="margin-top:8px;padding:8px 10px;background:rgba(255,59,59,.08);border:1px solid rgba(255,59,59,.25);border-radius:8px;font-size:11px;line-height:1.5">
    <div style="color:#ff6b6b;font-weight:700;margin-bottom:4px">🌊 Волна прорыва — ${wp.type}</div>
    <div>${wp.description}</div>
    <div style="color:#8ba0b6;margin-top:4px">скорость ≈ ${wp.speedMs} м/с · ширина до ${(wp.maxWidth/1000).toFixed(1)} км</div>
    ${(typeof RIVER_ELEV !== 'undefined' && RIVER_ELEV[h.id]) ?
      `<div style="color:#39d353;margin-top:4px">∿ расчёт: Сен-Венан 1D, профиль дна DEM, водосливная кривая прорана, n=0.035</div>` : ''}
    <div style="color:#8ba0b6;margin-top:2px;font-size:10px">${courseInfo}</div>
    <div style="color:#8ba0b6;font-size:10px">${resInfo}</div>
  </div>`;
}

function updateChart(){
  if (!S.selected || !S.chart) return;
  const now = performance.now();
  if (now - S.lastChartUpdate < CHART_THROTTLE_MS) return;
  S.lastChartUpdate = now;

  const r = S.results[S.selected];
  const h = HPPS.find(x => x.id === S.selected);
  if (!r || !h) return;

  const i = S.idx, W = CHART_WINDOW;
  const a = Math.max(0, i-W), b = Math.min(S.dates.length, i+W);
  const labels=[], pw=[], lv=[], qq=[];
  for (let k=a;k<b;k++){
    labels.push(S.dates[k].slice(5));
    pw.push(+r.power[k].toFixed(1));
    lv.push(+r.level[k].toFixed(2));
    const c = S.cache[S.mode]?.[S.selected];
    qq.push(c ? +(c.hydro.q[k]||0).toFixed(0) : 0);
  }
  S.chart.data.labels = labels;
  S.chart.data.datasets = [
    { label:'Мощность, МВт', data:pw, borderColor:'#31c9ff', backgroundColor:'rgba(49,201,255,.12)', borderWidth:1.6, fill:true, yAxisID:'y', tension:.25 },
    { label:'Уровень ВБ, м', data:lv, borderColor:'#ffb02e', borderWidth:1.4, yAxisID:'y1', tension:.25 },
    { label:'Приток, м³/с', data:qq, borderColor:'#3ddc84', borderWidth:1, borderDash:[3,3], yAxisID:'y1', tension:.25, hidden:true }
  ];
  S.chart.update('none');
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
(async function boot(){
  buildUI();
  try { await loadPeriod('history'); }
  catch(e){ console.error('Ошибка:', e); setStatus('<span class="err">ошибка: '+e.message+'</span>'); }
})();

window.addEventListener('error', e => console.error('Ошибка страницы:', e.error || e.message));