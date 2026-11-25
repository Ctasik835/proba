/* ============================================================
   GES MODEL — чистые расчётные функции сайта (без DOM и сети).

   Подключается обычным <script> ДО app.js: в браузере объявляет
   window.GES, в node (npm test) — module.exports. Здесь нет Leaflet,
   document и fetch: только календарь, форматирование и гидравлика,
   чтобы модель можно было проверять автотестами, а не глазами.

   Что здесь живёт и почему:
     · календарь — только UTC (локальные Date давали дубли/пропуски дней
       на переходах через летнее время, см. dayRange);
     · alignIndex — ряды станций разной длины (сутки vs месяцы, кэш vs
       синтетика) сводятся по ДАТЕ, а не по номеру элемента;
     · scenarioFactor — сценарии зависят от даты, а не от позиции бегунка;
     · simulate / releaseCalculate — модель ГЭС и каскад сброса.
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     КАЛЕНДАРЬ (только UTC)
     ============================================================ */
  const DAY_MS = 86400000;
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

  /* 'ГГГГ-ММ-ДД' (можно со временем/часом) → номер дня в UTC. */
  function isoToUTC(iso){
    const m = ISO_RE.exec(iso == null ? '' : String(iso));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  function utcToISO(ms){ return new Date(ms).toISOString().slice(0, 10); }
  function todayISO(offsetDays = 0){
    return utcToISO(Date.now() - offsetDays * DAY_MS);
  }

  /* Инклюзивный список дней между двумя датами. Итерация по миллисекундам
     (а не setDate у локальной Date) — единственная корректная способ:
     setDate+toISOString на DST даёт дубль дня и пропуск следующего. */
  function dayRange(startISO, endISO){
    const a = isoToUTC(startISO), b = isoToUTC(endISO);
    if (!isFinite(a) || !isFinite(b) || b < a) return [];
    const out = [];
    for (let ms = a; ms <= b; ms += DAY_MS) out.push(utcToISO(ms));
    return out;
  }

  /* Номер дня в году 1..366 по календарной дате (без локальной зоны). */
  function dayOfYear(iso){
    const ms = isoToUTC(iso);
    if (!isFinite(ms)) return 1;
    const y = +String(iso).slice(0, 4);
    return Math.max(1, Math.min(366, Math.round((ms - Date.UTC(y, 0, 1)) / DAY_MS) + 1));
  }
  function yearOf(iso){
    const m = ISO_RE.exec(iso == null ? '' : String(iso));
    return m ? +m[1] : NaN;
  }
  /* Дней в месяце: m — номер месяца 1..12. */
  function daysInMonth(y, m){
    return Math.round((Date.UTC(y, m, 1) - Date.UTC(y, m - 1, 1)) / DAY_MS);
  }

  /* ============================================================
     ПРИВЯЗКА РЯДОВ К ЕДИНОЙ ДАТЕ
     ============================================================ */
  const normDate = s => (typeof s === 'string' ? s.slice(0, 10) : s);

  function buildTimeIndex(times){
    const m = new Map();
    if (Array.isArray(times)){
      for (let k = 0; k < times.length; k++){
        const d = normDate(times[k]);
        if (d != null && !m.has(d)) m.set(d, k);
      }
    }
    return m;
  }

  /* Глобальный индекс бегунка → индекс в ряду станции. Возвращает -1, если
     у станции нет данных: вызывающий код обязан пропустить такую станцию,
     а не прочитать undefined[idx] (на этом падал весь render). */
  function alignIndex(idx, len, timeIndex, date){
    if (!len) return -1;
    if (timeIndex && date != null){
      const d = normDate(date);
      if (d != null && timeIndex.has(d)) return timeIndex.get(d);
    }
    return Math.max(0, Math.min(idx, len - 1));
  }

  /* ============================================================
     ФОРМАТ ЧИСЕЛ (русская запятая, NaN-безопасно)
     ============================================================ */
  const nfCache = new Map();
  function fixed(v, digits = 0){
    let f = nfCache.get(digits);
    if (!f){
      f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      nfCache.set(digits, f);
    }
    return f.format(v);
  }
  /* Число с фиксированным числом знаков; нечисло → '—' (а не 'NaN'). */
  function num(v, digits = 0){
    const n = Number(v);
    return Number.isFinite(n) ? fixed(n, digits) : '—';
  }
  function fmtMW(v){
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '0 МВт';
    return n >= 1 ? fixed(n, 0) + ' МВт' : fixed(n * 1000, 0) + ' кВт';
  }
  function fmtEnergyKWh(kwh){
    const n = Number(kwh);
    if (!Number.isFinite(n) || n <= 0) return '0 кВт·ч';
    return n / 1e9 >= 0.05 ? fixed(n / 1e9, 1) + ' млрд кВт·ч' : fixed(n / 1e6, 0) + ' млн кВт·ч';
  }
  /* Подпись деления оси графика мощности. */
  function fmtAxisPower(v){
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '0 кВт';
    return n >= 1 ? fixed(n, 0) + ' МВт' : fixed(n * 1000, 0) + ' кВт';
  }
  /* '2024-05-03' → '03.05.2024' */
  function fmtDateRu(iso){
    const m = ISO_RE.exec(iso == null ? '' : String(iso));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : '—';
  }

  /* ============================================================
     СЦЕНАРНЫЕ МНОЖИТЕЛИ РАСХОДА (по календарю)
     ============================================================ */
  /* Множитель к притоку зависит от ДАТЫ, а не от S.idx: при привязке к
     бегунку пик паводка «замирал» там, где сценарий включили, и уезжал
     при перемотке. Паводок усиливает реальное снеготаяние (пик ~10 мая,
     d.y. 130 — там же, где весенний горб у синтетики), засуха — летняя
     мемень, зимой она не искажает ряд. */
  function scenarioFactor(h, iso, scenario){
    if (scenario === 'flood'){
      const amp = Number.isFinite(h.floodAmp) ? h.floodAmp : 3.0;
      const mu  = Number.isFinite(h.floodDoy) ? h.floodDoy : 130;
      return 1 + amp * Math.exp(-Math.pow((dayOfYear(iso) - mu) / 28, 2));
    }
    if (scenario === 'drought'){
      const floor = Number.isFinite(h.droughtMin) ? h.droughtMin : 0.15;
      const f = Math.exp(-Math.pow((dayOfYear(iso) - 205) / 60, 2));
      return Math.max(floor, 1 - 0.85 * f);
    }
    return 1;
  }

  /* ============================================================
     СИНТЕТИКА (офлайн-фолбэк вместо Open-Meteo)
     ============================================================ */
  const HISTORY_START_DEFAULT = '2023-01-01';

  function syntheticData(h, mode, opts = {}){
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const startISO = opts.start || HISTORY_START_DEFAULT;
    let range;
    if (mode === 'forecast'){
      range = dayRange(utcToISO(now - 30 * DAY_MS), utcToISO(now + 16 * DAY_MS));
    } else if (mode === 'climate'){
      range = dayRange('2025-01-01', '2030-12-31');
    } else {
      range = dayRange(startISO, utcToISO(now - 8 * DAY_MS));
    }

    const times = range, qs = [], ts = [], ps = [];
    const QmaxT = (h.capacityMW || 0.05) * 1e6 / (1000 * 9.81 * h.head * h.eff);
    const Qmean = 0.4 * QmaxT;
    const seed = String(h.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const latF = Math.min(1, Math.abs(h.lat - 45) / 20);

    for (const iso of times){
      const doy = dayOfYear(iso);
      const ang = (doy / 365.25) * 2 * Math.PI;
      const spring = Math.exp(-Math.pow((doy - 130) / 45, 2));
      const noise = 0.85 + 0.3 * Math.sin(ang * 7 + seed) + 0.15 * Math.sin(ang * 23 + seed * 2);
      qs.push(Math.max(50, Qmean * (0.35 + 1.4 * spring) * noise));
      ts.push(5 + latF * 3 + (13 + latF * 5) * Math.sin(ang - Math.PI / 2 - 0.2) + 1.5 * Math.sin(ang * 5 + seed));
      ps.push(Math.max(0, 1.8 + 1.2 * Math.sin(ang + 1) + 0.6 * Math.sin(ang * 6 + seed)));
    }
    return { hydro: { time: times, q: qs }, clim: { time: times, t: ts, p: ps } };
  }

  /* ============================================================
     МОДЕЛЬ ГЭС: водный баланс водохранилища → выработка
     ============================================================ */
  function simulate(h, hydro, clim){
    const empty = { level: [], area: [], power: [], flow: [], spill: [], head: [], lf: [], kwh: 0, p1: 1 };
    if (!hydro || !Array.isArray(hydro.q) || !hydro.q.length) return empty;

    const dh = h.nmu - h.umo;
    const A0 = h.areaNMU * 1e6;
    const Vd = (h.totalVolume - h.usefulVolume) * 1e9;
    const p1 = Math.max(0.6, (A0 * dh) / (h.usefulVolume * 1e9));
    const p = p1 - 1;
    const VofX = x => Vd + A0 * dh * Math.pow(x, p1) / p1;
    const AofX = x => A0 * Math.pow(Math.max(x, 1e-6), p);
    const xOfV = v => Math.pow(Math.max(1e-6, v - Vd) * p1 / (A0 * dh), 1 / p1);
    const QmaxT = h.capacityMW * 1e6 / (1000 * 9.81 * h.head * h.eff);
    const tailBase = h.nmu - h.head;
    const n = hydro.q.length;
    const cap = h.capacityMW || 0;
    const out = { level: [], area: [], power: [], flow: [], spill: [], head: [], lf: [], kwh: 0 };
    const cs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + (hydro.q[i] || 0);
    const WIN = 60;
    const trail = i => { const a = Math.max(0, i - WIN), b = i + 1; return (cs[b] - cs[a]) / (b - a); };
    const targetX = 0.62;
    let vol = VofX(targetX);
    for (let i = 0; i < n; i++){
      const x = Math.min(1, Math.max(1e-6, xOfV(vol)));
      const level = h.umo + x * dh;
      const area = AofX(x);
      const T = (clim && clim.t && clim.t[i] != null) ? clim.t[i] : 8;
      const Pr = (clim && clim.p && clim.p[i] != null) ? clim.p[i] : 0;
      const Qevap = Math.max(0, 0.12 * (T + 2)) / 1000 * area / 86400;
      const Qrain = Pr / 1000 * area / 86400;
      const Qnet = Math.max(0, hydro.q[i] || 0) + Qrain - Qevap;
      const Qbase = trail(i);
      const err = level - (h.umo + targetX * dh);
      const Qrel = Math.max(0, Qbase + err * area / (20 * 86400));
      const tw = tailBase + 1.6 * Math.pow(Math.min(1.2, Qrel / (QmaxT + 1)), 0.5);
      const headNet = Math.max(2, (level - tw) * 0.97);
      const Qcap = QmaxT * Math.min(1.15, Math.sqrt(h.head / Math.max(5, headNet)));
      const Qt = Math.min(Qrel, Qcap);
      let Qsp = Math.max(0, Qrel - Qt);
      if (level < h.nmu - 0.5) Qsp = 0;
      let volNew = vol + (Qnet - Qt - Qsp) * 86400;
      if (volNew > VofX(1)){ Qsp += (volNew - VofX(1)) / 86400; volNew = VofX(1); }
      if (volNew < VofX(0.02)) volNew = VofX(0.02);
      vol = volNew;
      const qr = QmaxT > 0 ? Math.min(1, Qt / QmaxT) : 0;
      const etaPart = 1 - 0.30 * Math.pow(1 - qr, 2);
      const ice = T < -5 ? 0.98 : 1;
      let P = 1000 * 9.81 * Qt * headNet * h.eff * etaPart * ice / 1e6;
      P = Math.min(P, cap);
      out.kwh += P * 24;
      out.level.push(level); out.area.push(area / 1e6);
      out.power.push(P); out.flow.push(Qt + Qsp); out.spill.push(Qsp);
      out.head.push(headNet);
      /* У плотин без генератора (capacityMW = 0) деление давало 0/0 =
         NaN → «Загрузка: NaN %» в попапе и вечно красная метка. */
      out.lf.push(cap > 0 ? P / cap : 0);
    }
    out.p1 = p1;
    return out;
  }

  /* Обнушение выработки при «прорыве» — копией, а не правкой S.results
     на месте: mutate ряда ломал остальные сценарии после переключения. */
  function damBreakView(r){
    const n = r.level.length;
    const zero = () => new Array(n).fill(0);
    return Object.assign({}, r, {
      power: zero(), lf: zero(), flow: r.spill.slice(), spill: r.flow.slice(), kwh: 0
    });
  }

  /* ============================================================
     УЧЕБНЫЙ СЦЕНАРИЙ СБРОСА: каскад линейных резервуаров
     Паритет с эталоном «Перовка_финальный_алгоритм.js» — включая
     валидацию параметров и проверку замыкания водного баланса.
     ============================================================ */
  function validateRelease(p, pts){
    for (const k of Object.keys(p)){
      if (!Number.isFinite(p[k])) throw new Error(`release: параметр ${k} не число`);
    }
    if (!(p.area_m2 > 0 && p.mean_drawdown_m >= 0 && p.background_m3s >= 0 &&
          p.peak_time_s > 0 && p.duration_s > p.peak_time_s && p.dt_s > 0 &&
          p.speed_parameter_ms > 0 && p.horizon_s >= p.duration_s))
      throw new Error('release: недопустимые параметры');
    if (Math.abs(p.horizon_s / p.dt_s - Math.round(p.horizon_s / p.dt_s)) > 1e-9)
      throw new Error('release: горизонт должен быть кратен шагу');
    if (!Array.isArray(pts) || pts.length < 2) throw new Error('release: нужен маршрут из ≥2 точек');
    for (let j = 1; j < pts.length; j++){
      if (!(pts[j][0] - pts[j - 1][0] > 0)) throw new Error('release: расстояния должны возрастать');
    }
  }

  function releaseCalculate(p, pts){
    validateRelease(p, pts);
    const volume = p.area_m2 * p.mean_drawdown_m;
    const peak = 2 * volume / p.duration_s;
    const tau = pts.slice(1).map((v, j) => (v[0] - pts[j][0]) / p.speed_parameter_ms);
    const storage = tau.map(() => 0);
    const src = t => t <= p.peak_time_s ? peak * t / p.peak_time_s
      : (t <= p.duration_s ? peak * (p.duration_s - t) / (p.duration_s - p.peak_time_s) : 0);
    const steps = Math.round(p.horizon_s / p.dt_s);
    const R = tau.length;
    const out = new Float64Array((steps + 1) * R);
    let volumeIn = 0, volumeOut = 0;
    for (let n = 0; n <= steps; n++){
      const t = n * p.dt_s;
      let current = src(t);
      if (n > 0) volumeIn += current * p.dt_s;
      for (let j = 0; j < R; j++){
        if (n > 0){
          storage[j] = (storage[j] + current * p.dt_s) / (1 + p.dt_s / tau[j]);
          current = storage[j] / tau[j];
        } else current = 0;
        out[n * R + j] = current;
      }
      if (n > 0) volumeOut += current * p.dt_s;
    }
    const remaining = storage.reduce((a, b) => a + b, 0);
    const residual = volumeIn - volumeOut - remaining;
    const balance = { volumeIn, volumeOut, remaining, residual, ok: Math.abs(residual) <= 1e-8 * Math.max(1, volumeIn) };
    if (!balance.ok) throw new Error('release: не замыкается водный баланс (residual=' + residual + ' м³)');
    return { out, tau, steps, volume, peak, bg: p.background_m3s, dt: p.dt_s, horizon: p.horizon_s, balance,
             sourceVolume: volume, discretizationError: volumeIn - volume };
  }

  /* Сглаживание ряда (окно win) — для «прыгающих» месячных графиков. */
  function movingAverage(data, win){
    if (!Array.isArray(data)) return [];
    if (!win || win < 2) return data.slice();
    const out = [];
    const half = Math.floor(win / 2);
    for (let i = 0; i < data.length; i++){
      let s = 0, c = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++){ s += data[j]; c++; }
      out.push(c ? s / c : 0);
    }
    return out;
  }

  const GES = {
    DAY_MS, ISO_RE,
    isoToUTC, utcToISO, todayISO, dayRange, dayOfYear, yearOf, daysInMonth,
    buildTimeIndex, alignIndex, normDate,
    num, fmtMW, fmtAxisPower, fmtEnergyKWh, fmtDateRu,
    scenarioFactor, syntheticData, HISTORY_START_DEFAULT,
    simulate, damBreakView, movingAverage,
    validateRelease, releaseCalculate
  };

  global.GES = GES;
  if (typeof module === 'object' && module.exports) module.exports = GES;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
