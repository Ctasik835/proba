/* ============================================================
   ПАСПОРТНЫЕ ДАННЫЕ ГЭС
   flowDir — направление течения вниз по реке (0=С, 90=В, 180=Ю).
   ============================================================ */
const HPPS = [
  {id:'volzh', name:'Волжская ГЭС', river:'Волга', lat:48.8253, lon:44.6806, flowDir:180,
   capacityMW:2671, head:20, nmu:15, umo:12.5, areaNMU:3117, totalVolume:31.5, usefulVolume:6.5,
   eff:.93, year:1961, terrainAmpl:80, reservoirName:'Волгоградское'},
  {id:'zhig', name:'Жигулёвская ГЭС', river:'Волга', lat:53.4269, lon:49.4289, flowDir:90,
   capacityMW:2488, head:21, nmu:53, umo:49, areaNMU:6450, totalVolume:58, usefulVolume:21,
   eff:.93, year:1957, terrainAmpl:150, reservoirName:'Куйбышевское'},
  {id:'sar', name:'Саратовская ГЭС', river:'Волга', lat:52.0278, lon:47.7931, flowDir:200,
   capacityMW:1403, head:15, nmu:28, umo:25, areaNMU:1831, totalVolume:12.9, usefulVolume:4.5,
   eff:.92, year:1968, terrainAmpl:60, reservoirName:'Саратовское'},
  {id:'cheb', name:'Чебоксарская ГЭС', river:'Волга', lat:56.1358, lon:47.4647, flowDir:90,
   capacityMW:1370, head:14, nmu:63, umo:61, areaNMU:2182, totalVolume:13.8, usefulVolume:3.6,
   eff:.92, year:1986, terrainAmpl:70, reservoirName:'Чебоксарское'},
  {id:'nnov', name:'Нижегородская ГЭС', river:'Волга', lat:56.6419, lon:43.4911, flowDir:100,
   capacityMW:530, head:16, nmu:84, umo:81, areaNMU:1590, totalVolume:8.7, usefulVolume:3.9,
   eff:.91, year:1956, terrainAmpl:60, reservoirName:'Горьковское'},
  {id:'votk', name:'Воткинская ГЭС', river:'Кама', lat:56.9264, lon:53.9261, flowDir:190,
   capacityMW:1100, head:18, nmu:89, umo:86, areaNMU:1120, totalVolume:9.4, usefulVolume:2.8,
   eff:.92, year:1963, terrainAmpl:100, reservoirName:'Воткинское'},
  {id:'kam', name:'Камская ГЭС', river:'Кама', lat:58.1139, lon:56.3297, flowDir:200,
   capacityMW:552, head:17, nmu:108.5, umo:103.5, areaNMU:1910, totalVolume:12.2, usefulVolume:7.9,
   eff:.91, year:1958, terrainAmpl:120, reservoirName:'Камское'},
  {id:'ssh', name:'Саяно-Шушенская ГЭС', river:'Енисей', lat:52.8267, lon:91.3703, flowDir:0,
   capacityMW:6400, head:194, nmu:540, umo:500, areaNMU:621, totalVolume:31.3, usefulVolume:15.3,
   eff:.94, year:1985, terrainAmpl:900, reservoirName:'Саяно-Шушенское'},
  {id:'kras', name:'Красноярская ГЭС', river:'Енисей', lat:55.9333, lon:92.3000, flowDir:0,
   capacityMW:6000, head:93, nmu:243, umo:225, areaNMU:2000, totalVolume:73.3, usefulVolume:20,
   eff:.94, year:1972, terrainAmpl:400, reservoirName:'Красноярское'},
  {id:'bratsk', name:'Братская ГЭС', river:'Ангара', lat:56.2833, lon:101.7667, flowDir:10,
   capacityMW:4500, head:100, nmu:402, umo:392, areaNMU:5470, totalVolume:169.3, usefulVolume:48,
   eff:.94, year:1967, terrainAmpl:350, reservoirName:'Братское'}
];

const PRIORITY = ['ssh', 'kras', 'bratsk', 'volzh', 'zhig'];
const HISTORY_START = '2023-01-01';
const CHART_WINDOW = 60;
const CHART_THROTTLE_MS = 80;

/* ============================================================
   КАРТА
   ============================================================ */
const map = L.map('map', { zoomControl:true, preferCanvas:true }).setView([56.5, 60], 4);

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
const layerFlood   = L.layerGroup().addTo(map);
const layerMarkers = L.layerGroup().addTo(map);

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

async function fetchWithTimeout(url, ms=15000, opts={}){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(), ms);
  try {
    const r = await fetch(url, {signal:ctrl.signal, ...opts});
    if (r.status === 429){ const e=new Error('429'); e.is429=true; throw e; }
    if (!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function fetchWithRetry(url, ms=15000, tries=2){
  let lastErr;
  for (let k=0;k<tries;k++){
    try { return await fetchWithTimeout(url, ms); }
    catch(e){ lastErr=e; await sleep((e.is429?5000:1200)*(k+1)); }
  }
  throw lastErr;
}

/* ============================================================
   КЭШ
   ============================================================ */
const CACHE_KEY = 'ges_cache_v15';
const RIVER_KEY_PREFIX = 'ges_river_v6_';
const RES_KEY_PREFIX   = 'ges_res_v6_';
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
async function pingAPI(){
  try {
    await fetchWithTimeout(
      'https://api.open-meteo.com/v1/forecast?latitude=55&longitude=37&daily=temperature_2m_mean&forecast_days=1',
      4000);
    apiAvailable = true;
  } catch(e){
    apiAvailable = false;
    console.warn('Open-Meteo недоступен');
  }
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
  let lastErr;
  for (const m of OVERPASS_MIRRORS){
    try {
      const ctrl=new AbortController();
      const t=setTimeout(()=>ctrl.abort(), timeoutMs);
      const r=await fetch(m, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:'data='+encodeURIComponent(query),
        signal:ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    } catch(e){ lastErr=e; console.warn('Overpass '+m+': '+e.message); }
  }
  throw lastErr || new Error('Overpass недоступен');
}

/* ============================================================
   РУСЛО — с ГАРАНТИРОВАННЫМ ФОЛБЭКОМ
   ============================================================ */

/* Фолбэк: извилистая линия в направлении flowDir.
   ВСЕГДА возвращает валидный курс. */
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
    /* Меандр: 3 синусоиды разной частоты, амплитуда до ±0.7 рад (~40°) */
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

  /* 2. Пытаемся получить из OSM */
  let osmCourse = null;
  try {
    const query = `[out:json][timeout:20];
way(around:10000,${h.lat},${h.lon})["waterway"~"river|canal"];
out geom;`;

    const data = await overpassQuery(query, 18000);

    if (data.elements && data.elements.length){
      /* Все ways с геометрией и расстоянием до плотины */
      const ways = [];
      for (const el of data.elements){
        if (!el.geometry || el.geometry.length < 2) continue;
        const geom = el.geometry.map(p => [p.lat, p.lon]);
        let bestD = Infinity, bestIdx = 0;
        for (let i = 0; i < geom.length; i++){
          const d = haversineM(h.lat, h.lon, geom[i][0], geom[i][1]);
          if (d < bestD){ bestD = d; bestIdx = i; }
        }
        if (bestD < 3000) ways.push({ geom, bestD, bestIdx });
      }

      if (ways.length){
        ways.sort((a,b) => a.bestD - b.bestD);
        const w = ways[0];
        let g = w.geom;

        /* Определяем, в какую сторону идёт река.
           Считаем направление от точки idx к idx+3 и к idx-3.
           Сравниваем с flowDir. */
        const idx = w.bestIdx;
        const cosLat = Math.cos(h.lat * Math.PI / 180);
        const flowRad = (h.flowDir || 180) * Math.PI / 180;
        const fLat = Math.cos(flowRad), fLon = Math.sin(flowRad);

        const idxA = Math.min(idx + 5, g.length - 1);
        const idxB = Math.max(idx - 5, 0);

        const dotA = (g[idxA][0]-g[idx][0])*fLat + (g[idxA][1]-g[idx][1])*fLon*cosLat;
        const dotB = (g[idxB][0]-g[idx][0])*fLat + (g[idxB][1]-g[idx][1])*fLon*cosLat;

        /* Идём в ту сторону, где dot больше */
        const downstream = dotA >= dotB ? g.slice(idx) : g.slice(0, idx + 1).reverse();

        if (downstream.length >= 3){
          osmCourse = [ [h.lat, h.lon], ...downstream ];
          console.log(`Русло ${h.name} — OSM: ${osmCourse.length} точек`);
        }
      }
    }
  } catch(e){
    console.warn(`OSM-русло ${h.name} не удалось: ${e.message}`);
  }

  /* 3. Если OSM не дал — фолбэк */
  if (!osmCourse){
    const params = getWaveParams(h);
    osmCourse = makeFallbackCourse(h, params.maxDist * 1.5);
    console.log(`Русло ${h.name} — фолбэк по flowDir (${osmCourse.length} точек)`);
  }

  /* 4. Обрезаем и кэшируем */
  const params = getWaveParams(h);
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
    const query = `[out:json][timeout:20];
(
  way(around:25000,${h.lat},${h.lon})["natural"="water"];
  relation(around:25000,${h.lat},${h.lon})["natural"="water"];
  way(around:25000,${h.lat},${h.lon})["water"~"reservoir|lake"];
  relation(around:25000,${h.lat},${h.lon})["water"~"reservoir|lake"];
  way(around:25000,${h.lat},${h.lon})["waterway"="riverbank"];
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
          if (m.role === 'outer' && m.geometry && m.geometry.length >= 4){
            parts.push(m.geometry.map(p => [p.lat, p.lon]));
          }
        }
      }
      if (!parts.length) continue;

      /* Проверяем: НИ ОДНА точка не должна быть сильно ниже плотины */
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

      /* Если что-то вылезает вниз по течению более 3 км — отбрасываем */
      if (maxDownstream > 3000) continue;

      if (perim < 2000) continue;

      const dist = haversineM(h.lat, h.lon, cLat, cLon);
      if (dist > 25000) continue;

      /* Должен быть ВЫШЕ плотины */
      const dLat = cLat - h.lat;
      const dLon = (cLon - h.lon) * cosLat;
      const dotUp = dLat * upLat + dLon * upLon;
      if (dotUp < 0) continue;

      /* Проверка имени */
      const nm = (el.tags?.name || '').toLowerCase();
      let nameMatch = 0;
      if (nameRoot && nm.includes(nameRoot)) nameMatch = 1;

      candidates.push({ parts, perim, dist, nameMatch });
    }

    candidates.sort((a,b) => {
      if (a.nameMatch !== b.nameMatch) return b.nameMatch - a.nameMatch;
      return b.perim - a.perim;
    });

    const result = candidates.slice(0, 3).map(c => c.parts);
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
    radius: 7, color:'#ffffff', weight: 2.5,
    fillColor:'#888', fillOpacity: 1, opacity: 1
  }).addTo(layerMarkers);
  mk.on('click', () => selectHPP(h.id, false));
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

  S.results = {}; S.idx = 0; S.playing = false; S.damBreak = null;
  S.cache[mode] = {}; S.sources = {}; S.loadingStation = {};

  layerFlood.clearLayers();
  layerRes.clearLayers();
  S.reservoirs = {};
  $('playBtn').textContent = '▶';

  HPPS.forEach(h => {
    const item = document.querySelector(`.hppItem[data-id="${h.id}"]`);
    if (!item) return;
    item.querySelector('.src').className = 'src loading';
    item.querySelector('.mw').textContent = '…';
  });
  setStatus(`<span class="warn">загрузка</span> · ${mode}`);

  /* Этап 1: из кэша */
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

  /* Этап 2: проверка API */
  if (apiAvailable === null) await pingAPI();

  /* Этап 3: докачка */
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

  const queue = [...missing];
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

      if (!S.dates){
        S.dates = data.hydro.time;
        updateTimeline(mode);
      }
      recompute(); render();

      done++;
      setStatus(`<span class="warn">докачка</span> · ${done}/${missing.length}`);
      await sleep(300);
    }
  }
  await Promise.all([worker(), worker()]);

  const parts = [];
  if (fromCache) parts.push(`<span class="warn">🟡 ${fromCache} из кэша</span>`);
  if (countApi)  parts.push(`<span class="ok">🟢 ${countApi} онлайн</span>`);
  if (countSynth)parts.push(`<span class="err">🔴 ${countSynth} офлайн</span>`);
  setStatus(`<b>${mode}</b> · ${parts.join(' · ')}`);
  S.loading = false;
}

/* ============================================================
   ПАРАМЕТРЫ ВОЛНЫ — УВЕЛИЧЕНЫ
   ============================================================ */
function getWaveParams(h){
  const a = h.terrainAmpl || 100;
  if (a > 300){
    return { type:'горная', maxDist:60000, maxWidth:2000, speedMs:15,
             baseDuration:8, ringCount:4, description:'Узкая быстрая волна вдоль ущелья' };
  }
  if (a > 150){
    return { type:'предгорная', maxDist:80000, maxWidth:4000, speedMs:8,
             baseDuration:10, ringCount:4, description:'Волна средней ширины' };
  }
  return { type:'равнинная', maxDist:120000, maxWidth:8000, speedMs:3,
           baseDuration:12, ringCount:5, description:'Широкая медленная волна по пойме' };
}

function makeBandPolygon(centerline, widthM, latRef){
  const R = 6371000;
  const latR = latRef*Math.PI/180;
  const degLat = 180/(Math.PI*R);
  const degLon = 180/(Math.PI*R*Math.cos(latR));
  const left = [], right = [];
  const n = centerline.length;
  for (let i=0;i<n;i++){
    let dLat, dLon;
    if (i===0){ dLat=centerline[1][0]-centerline[0][0]; dLon=centerline[1][1]-centerline[0][1]; }
    else if (i===n-1){ dLat=centerline[i][0]-centerline[i-1][0]; dLon=centerline[i][1]-centerline[i-1][1]; }
    else { dLat=centerline[i+1][0]-centerline[i-1][0]; dLon=centerline[i+1][1]-centerline[i-1][1]; }
    const dxM = dLon/degLon, dyM = dLat/degLat;
    const lenM = Math.hypot(dxM, dyM) || 1;
    const nxM = -dyM/lenM, nyM = dxM/lenM;
    const halfW = widthM/2;
    const offLat = nyM*halfW*degLat;
    const offLon = nxM*halfW*degLon;
    left.push([centerline[i][0]+offLat, centerline[i][1]+offLon]);
    right.push([centerline[i][0]-offLat, centerline[i][1]-offLon]);
  }
  return [...left, ...right.reverse()];
}

function makeFloodWaveFromCourse(h, course, progress){
  if (progress <= 0 || progress >= 1) return null;
  const params = getWaveParams(h);
  const fraction = Math.pow(progress, 0.7);
  const targetLen = courseLength(course) * fraction;
  if (targetLen < 300) return null;
  const trimmed = trimCourse(course, targetLen);
  if (trimmed.length < 2) return null;
  const maxWidth = params.maxWidth * Math.min(1, progress * 1.6);
  const n = trimmed.length;
  const rings = [];
  for (let k=1;k<=params.ringCount;k++){
    const tStart=(k-1)/params.ringCount, tEnd=k/params.ringCount;
    const midT=(tStart+tEnd)/2;
    const width = maxWidth * (0.35 + 0.65*midT);
    const iStart=Math.max(0, Math.floor((n-1)*tStart));
    const iEnd=Math.min(n-1, Math.ceil((n-1)*tEnd));
    const segment = trimmed.slice(iStart, iEnd+1);
    if (segment.length < 2) continue;
    const pts = makeBandPolygon(segment, width, h.lat);
    const opacity = 0.12 + 0.35*(k/params.ringCount);
    rings.push({ pts, opacity });
  }
  return { rings, params };
}

/* ============================================================
   ПРОРЫВ
   ============================================================ */
async function startDamBreak(){
  if (!S.selected){ showStatusMsg('Выберите ГЭС'); return; }
  const h = HPPS.find(x => x.id === S.selected);
  if (!h || !S.cache[S.mode]?.[h.id]){ showStatusMsg('Данные недоступны'); return; }

  const params = getWaveParams(h);

  /* Русло: если нет в памяти — загружаем (с фолбэком) */
  if (!S.riverCourses[h.id]){
    showStatusMsg(`Загрузка русла ${h.river}…`);
    S.riverCourses[h.id] = await loadRiverCourse(h);
  }
  const course = S.riverCourses[h.id];

  /* НЕ должно случиться, но на всякий случай */
  if (!course || course.length < 3){
    showStatusMsg('Не удалось построить русло');
    return;
  }

  layerFlood.clearLayers();
  S.damBreak = { id:h.id, progress:0, start:performance.now(), duration:params.baseDuration, course };
  $('alertBanner').innerHTML = `💥 ПРОРЫВ ПЛОТИНЫ · ${params.type} волна · ${(courseLength(course)/1000).toFixed(0)} км`;
  $('alertBanner').classList.add('show');

  recompute(); render();
  $('details').innerHTML = detailsHTML(h);

  function step(t){
    if (!S.damBreak) return;
    const elapsed = (t - S.damBreak.start)/1000;
    S.damBreak.progress = Math.min(1, elapsed / S.damBreak.duration);
    layerFlood.clearLayers();

    const wave = makeFloodWaveFromCourse(h, course, S.damBreak.progress);
    if (wave){
      const fade = 1 - S.damBreak.progress * 0.5;
      wave.rings.forEach(ring => {
        L.polygon(ring.pts, {
          color:'#ff3b3b', weight:1.5, opacity:0.85,
          fillColor:'#ff5a5a', fillOpacity:ring.opacity*fade, interactive:false
        }).addTo(layerFlood);
      });
      const front = wave.rings[wave.rings.length - 1];
      if (front){
        L.polygon(front.pts, {
          color:'#ff1a1a', weight:3, opacity:0.95, fillOpacity:0, interactive:false
        }).addTo(layerFlood);
      }
    }
    render();
    if (S.damBreak.progress < 1) requestAnimationFrame(step);
    else setTimeout(() => {
      layerFlood.clearLayers();
      $('alertBanner').classList.remove('show');
      S.damBreak = null;
      $('details').innerHTML = detailsHTML(h);
    }, 6000);
  }
  requestAnimationFrame(step);
}

function stopDamBreak(){
  S.damBreak = null;
  layerFlood.clearLayers();
  $('alertBanner').classList.remove('show');
}

/* ============================================================
   ВОДОХРАНИЛИЩЕ — с фолбэком-эллипсом
   ============================================================ */
function drawReservoir(h, i, lf, overtop){
  if (S.reservoirs[h.id]){ layerRes.removeLayer(S.reservoirs[h.id]); delete S.reservoirs[h.id]; }
  const r = S.results[h.id];
  if (!r) return;

  let color, fill, op;
  if (overtop){ color='#ff3b3b'; fill='#ff6b6b'; op=0.35; }
  else if (lf > 0.75){ color='#31c9ff'; fill='#31c9ff'; op=0.20; }
  else { color='#31c9ff'; fill='#31c9ff'; op=0.13; }

  const osmPolys = S.reservoirsOSM[h.id];

  if (osmPolys && osmPolys.length){
    /* Реальные полигоны из OSM */
    const group = L.layerGroup();
    osmPolys.forEach(parts => {
      parts.forEach(pts => {
        L.polygon(pts, {
          color: color, weight: 1, opacity: 0.55,
          fillColor: fill, fillOpacity: op, interactive: false
        }).addTo(group);
      });
    });
    group.addTo(layerRes);
    S.reservoirs[h.id] = group;
    return;
  }

  /* Фолбэк: эллипс, растянутый вдоль реки ВЫШЕ плотины */
  const areaKm2 = r.area[i];
  const areaM2 = areaKm2 * 1e6;
  const aspect = 3;   // 3:1 вдоль реки
  const a = Math.sqrt(areaM2 * aspect / Math.PI);   // полуось вдоль реки
  const b = Math.sqrt(areaM2 / (Math.PI * aspect)); // полуось поперёк

  const upRad = ((h.flowDir || 180) + 180) * Math.PI / 180;
  const upLat = Math.cos(upRad);
  const upLon = Math.sin(upRad);
  const perpLat = -upLon;
  const perpLon = upLat;

  const R = 6371000;
  const latR = h.lat * Math.PI / 180;

  /* Центр эллипса — на расстоянии `a` вверх по течению */
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

  const poly = L.polygon(pts, {
    color: color, weight: 1, opacity: 0.55,
    fillColor: fill, fillOpacity: op, interactive: false
  }).addTo(layerRes);
  S.reservoirs[h.id] = poly;
}

/* ============================================================
   ИНТЕРФЕЙС
   ============================================================ */
function buildUI(){
  const list = $('hppList');
  $('hppCount').textContent = `(${HPPS.length})`;
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
    mk.bindPopup(popupHTML(h, r, i, col, isBroken, overtop), { maxWidth:320 });
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

  if (fromList) map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), 7), { duration:0.8 });
  S.markers[id]?.openPopup();

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
    if (!S.dates){ S.dates = data.hydro.time; updateTimeline(S.mode); }
    recompute(); render();
  }

  if (!S.riverCourses[h.id] && !S.loadingRiver[h.id]){
    S.loadingRiver[h.id] = loadRiverCourse(h).then(c => {
      S.riverCourses[h.id] = c; delete S.loadingRiver[h.id];
      if (S.selected === h.id) $('details').innerHTML = detailsHTML(h);
      return c;
    }).catch(() => { delete S.loadingRiver[h.id]; });
  }
  if (!S.reservoirsOSM[h.id] && !S.loadingRes[h.id]){
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
  const resInfo = S.reservoirsOSM[h.id]
    ? (S.reservoirsOSM[h.id].length ? `водохранилище: ${S.reservoirsOSM[h.id].length} объектов OSM` : 'водохранилище: фолбэк (эллипс)')
    : (S.loadingRes[h.id] ? 'водохранилище загружается…' : 'водохранилище: фолбэк');

  return `<h3>${h.name}</h3>
  <div style="font-size:11px;margin-bottom:6px">${srcLabel}</div>
  ${isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">💥 ПЛОТИНА РАЗРУШЕНА</div>' : ''}
  ${overtop && !isBroken ? '<div style="color:#ff6b6b;font-weight:700;margin-bottom:6px">⚠ КРИТИЧЕСКИЙ УРОВЕНЬ</div>' : ''}
  <div class="kv"><span>Река</span><span>${h.river}</span></div>
  <div class="kv"><span>Водохранилище</span><span>${h.reservoirName || '—'}</span></div>
  <div class="kv"><span>Координаты плотины</span><span>${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}</span></div>
  <div class="kv"><span>Течение (flowDir)</span><span>${h.flowDir}°</span></div>
  <div class="kv"><span>Установленная мощность</span><span>${h.capacityMW} МВт</span></div>
  <div class="kv"><span>Расчётный напор</span><span>${h.head} м</span></div>
  <div class="kv"><span>НПУ / УМО</span><span>${h.nmu} / ${h.umo} м</span></div>
  <div class="kv ${overtop?'danger':''}"><span>Текущий уровень</span><span>${r.level[i].toFixed(2)} м</span></div>
  <div class="kv ${overtop?'danger':''}"><span>Текущая мощность</span><span>${r.power[i].toFixed(0)} МВт</span></div>
  <div class="kv"><span>Выработка</span><span>${(r.kwh/1e9).toFixed(1)} млрд кВт·ч</span></div>
  <div style="margin-top:8px;padding:8px 10px;background:rgba(255,59,59,.08);border:1px solid rgba(255,59,59,.25);border-radius:8px;font-size:11px;line-height:1.5">
    <div style="color:#ff6b6b;font-weight:700;margin-bottom:4px">🌊 Волна прорыва — ${wp.type}</div>
    <div>${wp.description}</div>
    <div style="color:#8ba0b6;margin-top:4px">скорость ≈ ${wp.speedMs} м/с · ширина до ${(wp.maxWidth/1000).toFixed(1)} км</div>
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