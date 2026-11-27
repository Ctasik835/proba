/* Стенд «как в браузере»: index.html в jsdom с НАСТОЯЩИМИ Leaflet и Chart.js.
   Зачем: node --check и юнит-тесты не видят поломки вроде `type:'line'` не в
   том месте конфига Chart.js — конструктор тогда не падает, а ломается первая
   же отрисовка, и из одного пропуска вырастает «пустые графики + мёртвая
   перемотка + лагающий сброс». Этот прогон поднимает страницу целиком и
   проверяет 50 сценарных шагов (в обычном режиме).

   Запуск (зависимости не входят в репозиторий — стенд dev-инструмент):
     npm i --no-save jsdom leaflet@1.9.4 chart.js@4.4.1
     npm run smoke
     SMOKE_OFFLINE=1 npm run smoke                      # сеть падает
     SMOKE_NARROW=1 SMOKE_MOTION=reduce npm run smoke   # узкий экран + меньше движения
     SMOKE_CHARTS=0 npm run smoke                       # графики закрыты в прошлой сессии
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const resolve = (spec) => {
  try { return require_.resolve(spec); }
  catch {
    console.error('Нет модуля ' + spec + '. Нужно: npm i --no-save jsdom leaflet chart.js');
    process.exit(2);
  }
};
/* всё через createRequire: тогда работают и ./node_modules, и NODE_PATH */
const { JSDOM, VirtualConsole } = require_('jsdom');
const LEAFLET = path.resolve(resolve('leaflet/dist/leaflet.js'), '..');
/* у chart.js поле exports не отдаёт ./dist/* — идём от корня пакета */
const CHART_UMD = path.join(path.resolve(resolve('chart.js'), '../..'), 'dist', 'chart.umd.js');
if (!fs.existsSync(CHART_UMD)){
  console.error('Не найден ' + CHART_UMD + ' — версия chart.js должна совпадать с CDN в index.html (4.4.x)');
  process.exit(2);
}

const OFFLINE = process.env.SMOKE_OFFLINE === '1';
const NARROW = process.env.SMOKE_NARROW === '1';
const REDUCE = process.env.SMOKE_MOTION === 'reduce';
/* значение ges_charts_v1 «до старта» — проверяем, что скрытые в прошлой
   сессии графики не всплывают сами */
const CHARTS_SEED = process.env.SMOKE_CHARTS || '';

const errors = [];
const warns = [];
/* коротко: дамп минифицированного chart.umd.js/leaflet.js только заглушает вывод */
const brief = e => String((e && (e.stack || e.message)) || e).split('\n')
  .filter(l => !/chart\.umd|leaflet\.js|runtime-script-errors|EventTarget-impl|Window\.js/.test(l))
  .slice(0, 3).join(' | ');
const vc = new VirtualConsole();
/* attempts of navigation — это НЕ ошибка приложения: location.reload() в jsdom
   всегда «Not implemented», и именно так мы видим, что перезагрузка вызвана */
let navAttempts = 0;
vc.on('jsdomError', e => {
  const m = brief(e);
  if (/Not implemented: navigation/.test(m)){ navAttempts++; return; }
  errors.push('jsdomError: ' + m);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ').slice(0, 200)));
vc.on('warn', (...a) => warns.push(a.join(' ')));
/* эти обработчики мешают процессу упасть — значит, они ОБЯЗАНЫ напечатать
   причину сразу, иначе ошибка самого стенда выглядит как «тихий успех» */
process.on('uncaughtException', e => { console.log('!! ошибка стенда:', brief(e)); errors.push('uncaught: ' + brief(e)); });
process.on('unhandledRejection', e => { console.log('!! ошибка стенда (rejection):', brief(e)); errors.push('rejection: ' + brief(e)); });

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html
  .replace('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'file://' + path.join(LEAFLET, 'leaflet.css'))
  .replace('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'file://' + path.join(LEAFLET, 'leaflet.js'))
  .replace('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js', 'file://' + CHART_UMD);

/* широты — как в HPPS (krav, andr, pero, igla, rokk, alak): моковый ответ
   Open-Meteo обязан «походить» на станцию, иначе проверка съедет вместе с
   координатами — например, у Андреевской створ лежит на русле 60.71783 */
const LAT = [60.768, 60.71783, 60.67992, 60.52897, 60.2913, 60.6077];
const NDAYS = 400;
function days(n){
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  return out;
}
function climPayload(i){
  const time = days(NDAYS);
  return {
    latitude: LAT[i], longitude: 28 + i, elevation: 10 + i, model: 'best_match',
    grid_code: '0.1', timezone: 'UTC',
    daily: {
      time,
      temperature_2m_mean: time.map((d, k) => 3 + 10 * Math.sin(k / 58 + i)),
      precipitation_sum: time.map((d, k) => Math.abs(1.5 * Math.sin(k / 21 + i)) + 0.2)
    }
  };
}
function floodPayload(i){
  const time = days(NDAYS);
  return {
    latitude: LAT[i], longitude: 28 + i, model: 'glofas3', grid_code: '0.1', timezone: 'UTC',
    daily: { time, river_discharge: time.map((d, k) => 6 + 9 * Math.abs(Math.sin(k / 45 + i))) }
  };
}

const dom = new JSDOM(html, {
  url: 'file://' + ROOT + '/index.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window){
    /* --- canvas: контекст с псевдо-2D-API API + счётчиком вызовов.
       preferCanvas:true ⇒ полигоны Leaflet рисует не в DOM, а в контекст,
       поэтому число операций — единственный способ увидеть «волна рисуется». --- */
    window.__ops = 0; window.__opsBy = {};
    window.HTMLCanvasElement.prototype.getContext = function(){
      const canvas = this;
      const tally = m => function(){ window.__ops++; window.__opsBy[m] = (window.__opsBy[m] || 0) + 1; };
      const base = {
        canvas,
        measureText: t => ({ width: String(t || '').length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createPattern: () => null,
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)) }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        isPointInPath: () => false
      };
      for (const m of ['save','restore','beginPath','closePath','moveTo','lineTo','arc','arcTo','rect','fill','stroke',
                       'clip','fillRect','clearRect','strokeRect','translate','rotate','scale','setTransform',
                       'transform','resetTransform','setLineDash','drawImage','quadraticCurveTo','bezierCurveTo',
                       'ellipse','fillText','strokeText']) base[m] = tally(m);
      return new Proxy(base, {
        get: (t, k) => (k in t ? t[k] : (typeof k === 'string' &&
          /^(font|fillStyle|strokeStyle|lineWidth|lineCap|lineJoin|globalAlpha|globalCompositeOperation|textAlign|textBaseline|shadowBlur|shadowColor|miterLimit|filter)$/.test(k) ? '' : () => {})),
        set: (t, k, v) => { t[k] = v; return true; }
      });
    };

    /* --- сеть: пакетный ответ Open-Meteo как в жизни (массив по числу точек) --- */
    window.fetch = (url) => {
      const u = String(url);
      if (OFFLINE) return Promise.reject(new TypeError('offline (smoke)'));
      if (u.includes('open-meteo.com')){
        const flood = u.includes('/flood');
        const lats = (u.match(/latitude=([\d.,-]+)/) || [, ''])[1].split(',').map(Number);
        const payload = lats.map((la) => {
          const idx = Math.max(0, LAT.indexOf(la));
          return flood ? floodPayload(idx) : climPayload(idx);
        });
        /* в jsdom нет своего Response — достаточно объекта с json()/ok */
        const body = lats.length === 1 ? payload[0] : payload;
        const text = JSON.stringify(body);
        return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => text });
      }
      return Promise.reject(new TypeError('нет сети для ' + u.slice(0, 60)));
    };

    /* --- service worker: управляемая подделка. Нужна, чтобы проверить плашку
       «Доступна новая версия»: её показ теперь зависит от того, остался ли
       воркер в reg.waiting (т.е. install НЕ дошёл до skipWaiting). --- */
    const mkTarget = () => {
      const o = { _h: {}, addEventListener(t, cb){ (o._h[t] = o._h[t] || []).push(cb); },
                  removeEventListener(){}, fire(t, ev){ (o._h[t]||[]).forEach(cb => cb(Object.assign({type:t}, ev||{}))); } };
      return o;
    };
    const swReg = mkTarget(), swWorker = mkTarget();
    swReg.installing = null; swReg.waiting = null;
    const posts = [];
    swWorker.postMessage = m => posts.push(m);
    const reloads = { n: 0 };
    window.__sw = {
      reg: swReg, worker: swWorker, posts, reloads,
      /* install отработал и вызвал skipWaiting: воркер активировался сам,
         reg.waiting остаётся null → показывать кнопку не за чем */
      settledInstalled(){
        swReg.installing = swWorker; swReg.waiting = null;
        swWorker.state = 'installed';
        swReg.fire('updatefound');          // браузер именно так и сообщает
        swWorker.fire('statechange');
        swReg.installing = null;
        swWorker.state = 'activated';
        window.navigator.serviceWorker.fire('controllerchange');
      },
      /* install застрял (не дошёл до skipWaiting): reg.waiting != null —
         единственный случай, когда пользователю действительно нужна кнопка */
      stuckWaiting(){
        swReg.installing = swWorker; swReg.waiting = swWorker;
        swWorker.state = 'installed';
        swReg.fire('updatefound');
        swWorker.fire('statechange');
      }
    };
    try { delete window.navigator.serviceWorker; } catch(e){}
    const swIface = Object.assign(mkTarget(), { register: () => Promise.resolve(swReg), controller: null });
    window.__sw.swTarget = swIface;
    Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: swIface });
    Object.defineProperty(window, 'innerWidth', { value: NARROW ? 420 : 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: NARROW ? 780 : 900, configurable: true });
    window.matchMedia = q => ({
      matches: /max-width:\s*900px/.test(q) ? NARROW : /prefers-reduced-motion/.test(q) ? REDUCE : false,
      media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}
    });
    const W_BY_ID = { sidebar: 330, chartPanel: 450, statusBar: 210 };
    window.Element.prototype.getBoundingClientRect = function(){
      /* учёт inline left/top: без этого перетаскивание окон не проверить —
         makeDraggable читает геометрию именно этим методом */
      const num = v => (typeof v === 'string' && /px$/.test(v)) ? parseFloat(v) : NaN;
      const st = this.style || {};
      const left = isNaN(num(st.left)) ? 12 : num(st.left);
      const top  = isNaN(num(st.top)) ? 64 : num(st.top);
      const w = W_BY_ID[this.id] || 240;
      return { left, top, right: left + w, bottom: top + 236, width: w, height: 236, x: left, y: top };
    };
    window.Element.prototype.setPointerCapture = window.Element.prototype.setPointerCapture || function(){};
    window.Element.prototype.releasePointerCapture = window.Element.prototype.releasePointerCapture || function(){};
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    /* jsdom запрещает localStorage на file:// (opaque origin) — а приложению он
       нужен: кэш снимка, раскладка окон и намерение «графики скрыты». Без стаба
       эти ветки молча выпадали в catch и вообще не проверялись. */
    const store = new Map(CHARTS_SEED ? [['ges_charts_v1', CHARTS_SEED]] : []);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: k => { store.delete(k); },
        clear: () => store.clear(),
        key: i => Array.from(store.keys())[i] === undefined ? null : Array.from(store.keys())[i],
        get length(){ return store.size; }
      }
    });
    window.__store = store;
  }
});

const { window } = dom;
const wait = ms => new Promise(r => setTimeout(r, ms));
const d = window.document;
const q = s => d.querySelector(s);
const qa = s => [...d.querySelectorAll(s)];
const chart = id => window.Chart && window.Chart.getChart(d.getElementById(id));
const click = el => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

let failed = 0;
function check(name, cond, extra){
  if (!cond) failed++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + String(extra).slice(0, 150) : ''));
}

/* Страховка: обработчики ниже ловят uncaught/unhandled и не дают процессу
   упасть — без таймера стенд мог бы висеть вместо того, чтобы показать провал. */
const watchdog = setTimeout(() => {
  console.error('\nТАЙМАУТ: стенд не дошёл до конца (см. errors ниже)');
  console.log(errors.slice(0, 3).join('\n'));
  process.exit(1);
}, 100000);

await wait(900);

/* ---------- старт приложения ---------- */
check('нет ошибок страницы на старте', errors.length === 0, errors.slice(0, 2).join(' /// ') || 'чисто');
check('список станций построен', qa('.hppItem').length === 6, qa('.hppItem').length);
check('графики созданы настоящим Chart.js', !!chart('chartPowerC') && !!chart('chartLevelC'),
  'config.type: ' + (chart('chartPowerC')?.config.type));
check('тип графика в КОРНЕ конфига (regression v46)',
  chart('chartPowerC')?.config.type === 'line' && chart('chartLevelC')?.config.type === 'line');
check('таймлайн инициализирован', +q('#slider').max > 100, 'max=' + q('#slider').max);
check('легенда цветов построена', qa('#legend .lgItem').length >= 6, qa('#legend .lgItem').length);
check('штамп сборки из version.js', /^v\d+$/.test(q('#buildStampVer').textContent), q('#buildStampVer').textContent);

if (OFFLINE){
  await wait(2500);
  check('офлайн: статус про синтетику', /офлайн/.test(q('#statusText').textContent), q('#statusText').textContent.slice(0, 90));
} else {
  await wait(3000);
  const st = q('#statusText').textContent;
  check('онлайн-путь: данные получены пакетным запросом', /онлайн/.test(st) && !/офлайн/.test(st), st.slice(0, 90));
}

/* ---------- выбор станции + содержимое графиков ---------- */
click(q('.hppItem[data-id="pero"]'));
await wait(450);
check('паспорт станции открыт', /Перовская/.test(q('#details').textContent));
check('панель открыта — или остаётся скрытой по намерению из прошлой сессии',
  q('#chartPanel').classList.contains('show') === (CHARTS_SEED !== '0'),
  'show=' + q('#chartPanel').classList.contains('show') + ' · seed=' + (CHARTS_SEED || 'нет'));
{
  const n = chart('chartPowerC')?.data.datasets[0]?.data.length || 0;
  const ln = chart('chartLevelC')?.data.datasets[0]?.data.length || 0;
  check('график мощности наполнился (окно ±CHART_WINDOW)', n > 10, n + ' точек');
  check('график уровня наполнился', ln > 10, ln + ' точек');
  check('точки графика — конечные числа',
    (chart('chartPowerC')?.data.datasets[0]?.data || []).every(Number.isFinite));
  check('оси не aliased (x у мощности скрыт, у уровня показан)',
    chart('chartPowerC').options.scales.x.display === false && chart('chartLevelC').options.scales.x.display === true);
  check('подсказка мощности включена', chart('chartPowerC').options.plugins.tooltip.enabled === true);
}
/* ---------- скрытие/показ графиков ---------- */
if (CHARTS_SEED === '0'){
  check('скрытые в прошлой сессии графики не всплыли при выборе станции',
    !q('#chartPanel').classList.contains('show') && q('#chartShowBtn').hidden === false,
    'show=' + q('#chartPanel').classList.contains('show') +
    ' · пилюля скрыта: ' + q('#chartShowBtn').hidden);
  check('✕ в шапке задизейблен, пока панели нет', q('#chartHideBtn').disabled === true);
  check('данные при этом всё равно считаются (ряд на графике есть)',
    (chart('chartPowerC')?.data.datasets[0]?.data.length || 0) > 10,
    chart('chartPowerC')?.data.datasets[0]?.data.length + ' точек');
  click(q('#chartShowBtn'));
  await wait(300);
  check('пилюля возвращает панель', q('#chartPanel').classList.contains('show'),
    'ges_charts_v1=' + window.__store.get('ges_charts_v1'));
} else {
  const wasShown = q('#chartPanel').classList.contains('show');
  check('при выборе станции графики открыты', wasShown);
  click(q('#chartHideBtn'));
  await wait(150);
  check('✕ скрывает панель графиков', !q('#chartPanel').classList.contains('show'));
  check('на её месте появилась пилюля «Графики»', q('#chartShowBtn').hidden === false);
  check('намерение запомнено (перезагрузка не вернёт графики)',
    window.__store.get('ges_charts_v1') === '0', 'ges_charts_v1=' + window.__store.get('ges_charts_v1'));
  check('тумблер 📈 синхронизирован со скрытым состоянием',
    q('#chartToggle').getAttribute('aria-expanded') === 'false' &&
    !q('#chartToggle').classList.contains('on'));
  click(q('.hppItem[data-id="igla"]'));
  await wait(300);
  check('скрытые графики НЕ всплывают при выборе другой станции',
    !q('#chartPanel').classList.contains('show'), 'show=' + q('#chartPanel').classList.contains('show'));
  click(q('#chartShowBtn'));
  await wait(300);
  check('пилюля возвращает панель и рядом с новой станцией',
    q('#chartPanel').classList.contains('show') &&
    /Игла/.test(q('#chartTitle').textContent), q('#chartTitle').textContent);
  check('после возврата ряд перерисован (resize + update)',
    (chart('chartPowerC')?.data.datasets[0]?.data.length || 0) > 10,
    chart('chartPowerC')?.data.datasets[0]?.data.length + ' точек');
  check('ges_charts_v1 снова «1»', window.__store.get('ges_charts_v1') === '1');
  /* Esc закрывает по одному слою */
  q('#map').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  check('Esc прячет графики', !q('#chartPanel').classList.contains('show'));
  q('#map').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(120);
  check('второй Esc не ломает страницу', errors.length === 0, errors.slice(0, 1).join(''));
  click(q('#chartToggle'));
  await wait(300);
  check('тумблер 📈 тоже возвращает панель', q('#chartPanel').classList.contains('show'),
    'aria-expanded=' + q('#chartToggle').getAttribute('aria-expanded'));
}

click(q('.hppItem[data-id="igla"]'));
await wait(300);
check('«Игла» (без генератора) без NaN', !/NaN/.test(q('#details').textContent));

/* ---------- перемотка ---------- */
const before = q('#dateBox').textContent;
click(q('#playBtn'));
await wait(1200);
click(q('#playBtn'));
check('время на таймлайне движется', q('#dateBox').textContent !== before, before + ' → ' + q('#dateBox').textContent);
check('в подписях нет NaN/undefined', !/NaN|undefined/.test(q('#details').textContent + q('#dateBox').textContent));
check('нет ошибок после перемотки', errors.length === 0, errors.slice(0, 1).join(''));

/* ---------- сценарии ---------- */
click(q('.hppItem[data-id="pero"]'));
await wait(250);
for (const sc of ['flood', 'drought']){
  click(q(`.scenBtn[data-scen="${sc}"]`));
  await wait(350);
  const pts = chart('chartPowerC')?.data.datasets[0]?.data || [];
  check(`сценарий ${sc}: ряд пересчитан`, pts.length > 10 && pts.every(Number.isFinite), pts.length + ' точек');
}
click(q('.scenBtn[data-scen="normal"]'));
await wait(250);

/* ---------- зум при выборе ГЭС ---------- */
/* Кадр проверяем по перехвату fitBounds/flyToBounds: в jsdom анимация карты
   не доигрывает, зато видно, ЧТО именно приложение попросило показать. */
const fits = [];
{
  const proto = window.L.Map.prototype;
  for (const m of ['fitBounds', 'flyToBounds']){
    const orig = proto[m];
    proto[m] = function(bnds, o){
      const b = window.L.latLngBounds(bnds);
      fits.push({ via: m, maxZoom: o && o.maxZoom, pad: !!(o && o.paddingTopLeft),
                  spanLat: b.isValid() ? (b.getNorth() - b.getSouth()) : 0,
                  spanLng: b.isValid() ? (b.getEast() - b.getWest()) : 0,
                  sw: b.isValid() ? [b.getSouth(), b.getWest()] : null,
                  ne: b.isValid() ? [b.getNorth(), b.getEast()] : null });
      return orig.call(this, bnds, o);
    };
  }
}
{
  const n0 = fits.length;
  click(q('.hppItem[data-id="rokk"]'));
  await wait(900);
  const f = fits.slice(n0).pop();
  check('выбор ГЭС кадрирует на станцию, а не перелетает на точку',
    !!f && f.maxZoom === 16 && f.pad,
    f ? (f.via + ' · maxZoom ' + f.maxZoom + ' · padding ' + f.pad) : 'fitBounds не вызван');
  check('станция без чаши — кадр по максимуму, а не по миру целиком',
    !!f && f.spanLat < 1e-6 && f.spanLng < 1e-6 && f.maxZoom === 16,
    f ? ('span ' + f.spanLat.toFixed(6) + '×' + f.spanLng.toFixed(6)) : 'нет кадра');
  check('кадр станции не валят страницу', errors.length === 0, errors.slice(0, 1).join(''));
  /* Перовская: в кадр обязан попасть РЕАЛЬНЫЙ контур (0,0039° по широте,
     0,0076° по долготе) — иначе «зум на ГЭС» показывает не ГЭС */
  {
    const n1 = fits.length;
    click(q('.hppItem[data-id="pero"]'));
    await wait(1000);   /* русло/данные подгружаются — fitBounds может прийти вторым заходом */
    const got = fits.slice(n1);
    /* рамка обязана накрывать ВЕСЬ реальный контур (bbox снимка OSM при НПВ):
       lat 60.676292…60.680235, lon 28.950914…28.958536 */
    const covers = (f) => !!f && f.sw && f.ne &&
      f.sw[0] <= 60.676293 && f.ne[0] >= 60.680234 && f.sw[1] <= 28.950915 && f.ne[1] >= 28.958535;
    const fp = got.filter(covers).pop() || got[got.length - 1];
    check('на Перовскую кадрируем чашу целиком (рамка накрывает весь контур)', covers(fp),
      'кадров: ' + got.length + ' · ' + (fp && fp.sw ? ('lat ' + fp.sw[0].toFixed(5) + '…' + fp.ne[0].toFixed(5) +
      ' · lon ' + fp.sw[1].toFixed(5) + '…' + fp.ne[1].toFixed(5)) : 'нет'));
  }
  check('кадр Перовской не валят страницу', errors.length === 0, errors.slice(0, 1).join(''));
}

/* подглядываем за созданием поповера: L.popup возвращает объект, у которого
   потом проверяем offset (именно он отвечает «над маркером окно или под») */
const popups = [];
{
  const orig = window.L.popup;
  window.L.popup = function(...a){ const p = orig.apply(this, a); popups.push(p); return p; };
}

/* ---------- прорыв ---------- */
click(q('.scenBtn[data-scen="dam_break"]'));
await wait(2500);
check('прорыв: слой волны добавлен на карту',
  qa('#map .leaflet-overlay-pane path').length + qa('#map canvas').length > 0,
  'слоёв в overlay: ' + (qa('#map .leaflet-overlay-pane path').length + qa('#map canvas').length));
check('прорыв: полигон реально отрисован (setLatLngs → контекст)',
  (window.__opsBy.lineTo || 0) > 20, 'lineTo всего: ' + (window.__opsBy.lineTo || 0));
check('прорыв: баннер с фронтом', /ПРОРЫВ/.test(q('#alertBanner').textContent) && !/NaN/.test(q('#alertBanner').textContent),
  q('#alertBanner').textContent.slice(0, 70).replace(/\s+/g, ' '));
if (REDUCE){
  check('прорыв (reduced motion): показан сразу полный охват, без анимации',
    /t\+\d+ч/.test(q('#alertBanner').textContent), q('#alertBanner').textContent.slice(0, 40).replace(/\s+/g, ' '));
} else {
  const ops0 = window.__ops, t1 = q('#alertBanner').textContent;
  await wait(1600);
  check('прорыв: кадры волны идут (анимация, а не статичная карта)',
    window.__ops > ops0 && q('#alertBanner').textContent !== t1,
    'ops: ' + ops0 + ' → ' + window.__ops + ' · ' + q('#alertBanner').textContent.slice(0, 32).replace(/\s+/g, ' '));
}
{
  await wait(700);                     /* окно прорыва открывается по таймеру (500 мс) */
  const pop = popups[popups.length - 1];
  const el = pop && pop.getElement && pop.getElement();
  check('прорыв: окно у плотины открыто', !!pop && !!q('#map .leaflet-popup'),
    'поповеров создано: ' + popups.length);
  const cls = el ? String(el.className) : '';
  check('прорыв: у окна перевёрнутый хвост (класс pop-under)', /pop-under/.test(cls), cls || 'нет контейнера');
  const oy = pop ? pop.options.offset[1] : null;
  const hh = el ? (el.getBoundingClientRect().height || el.offsetHeight) : 0;
  check('прорыв: окно ПОД маркером (смещено на собственную высоту, как при сбросе)',
    hh > 0 && oy >= hh - 1, 'offset.y=' + oy + ' · высота окна=' + Math.round(hh));
  const cont = pop && pop._container;
  const bot = cont && cont.style.bottom ? parseFloat(cont.style.bottom) : null;
  check('прорыв: окно позиционирует Leaflet (bottom отрицательный — окно под точкой)',
    bot !== null && bot < 0, 'bottom=' + (cont ? cont.style.bottom : 'нет контейнера'));
}
check('прорыв: без ошибок', errors.length === 0, errors.slice(0, 1).join(''));
click(q('.scenBtn[data-scen="reset"]'));
await wait(400);
{
  /* поповер выбранной станции открыт легально — ищем именно окно прорыва */
  const pops = qa('#map .leaflet-popup').map(el => el.textContent);
  check('прорыв выключен: окно «ПЛОТИНА РАЗРУШЕНА» закрыто',
    !pops.some(t => /ПЛОТИНА РАЗРУШЕНА/.test(t)),
    pops.length ? 'остались окна: ' + pops.join(' || ').slice(0, 70) : 'поповеров нет');
}

/* ---------- сторона окна = против хода воды ---------- */
{
  /* Андреевка течёт на юг, поэтому окно обязано встать НАД створом — иначе оно
     ляжет на русло, по которому как раз бежит волна. Заодно это проверка, что
     метка Андреевской стоит на реке: прорыв считается по её руслу и профилю. */
  const n0 = popups.length;
  click(q('.hppItem[data-id="andr"]'));
  await wait(800);
  click(q('.scenBtn[data-scen="dam_break"]'));
  await wait(2600);
  const pop = popups.slice(n0).pop();
  const el = pop && pop.getElement && pop.getElement();
  const cls = el ? String(el.className) : '';
  const oy = pop ? pop.options.offset[1] : null;
  check('Андреевская (вода на юг): окно прорыва встало СВЕРХУ створа',
    /pop-above/.test(cls) && oy !== null && oy <= 0,
    'cls=' + (cls || 'нет контейнера') + ' · offset.y=' + oy);
  check('Андреевская: прорыв считается без ошибок', errors.length === 0, errors.slice(0, 1).join(''));
  click(q('.scenBtn[data-scen="reset"]'));
  await wait(300);
  /* Кравцовская: Селезнёвка течёт на ВСВ — окно обязано уехать влево, чтобы
     не накрыть русло; это боковой вариант раскладки (хвост на грани окна) */
  const n1 = popups.length;
  click(q('.hppItem[data-id="krav"]'));
  await wait(800);
  click(q('.scenBtn[data-scen="dam_break"]'));
  await wait(2600);
  const pk = popups.slice(n1).pop();
  const elK = pk && pk.getElement && pk.getElement();
  const ox = pk ? pk.options.offset[0] : null;
  check('Кравцовская (вода на восток): окно прорыва уехало СЛЕВА от створа',
    /pop-left/.test(String(elK && elK.className)) && ox !== null && ox < 0,
    'cls=' + String(elK && elK.className).replace('leaflet-popup ', '') + ' · offset.x=' + ox);
  check('боковое окно не перекрывает маркер (смещение >= половины ширины)',
    ox !== null && elK && Math.abs(ox) >= (elK.getBoundingClientRect().width || 0) / 2,
    'offset.x=' + ox + ' · ширина=' + (elK ? Math.round(elK.getBoundingClientRect().width) : 0));
  click(q('.scenBtn[data-scen="reset"]'));
  await wait(400);
  click(q('.hppItem[data-id="pero"]'));
  await wait(800);
}

/* ---------- учебный сброс ---------- */
/* popups/L.popup перехвачены выше — до блока «прорыв», чтобы снять и окно
   «ПЛОТИНА РАЗРУШЕНА» */
const t0 = Date.now();
click(q('.scenBtn[data-scen="release"]'));
await wait(1400);
const rc = chart('chartPowerC');
check('сброс: 6 серий на графике', (rc?.data.datasets.length || 0) === 6, rc?.data.datasets.length + ' серий');
check('сброс: легенда включена', rc?.options.plugins.legend.display === true);
check('сброс: точки серий — конечные числа',
  (rc?.data.datasets || []).every(ds => ds.data.length > 20 && ds.data.every(Number.isFinite)),
  (rc?.data.datasets || []).map(ds => ds.data.length).join('/'));
check('сброс: в баннере числа нормальные', /м³\/с/.test(q('#alertBanner').textContent) && !/NaN/.test(q('#alertBanner').textContent),
  q('#alertBanner').textContent.slice(0, 70).replace(/\s+/g, ' '));
check('сброс: остальные станции заблокированы', qa('.hppItem:disabled').length === 5, qa('.hppItem:disabled').length);
check('сброс: паспорт станции с балансом', /Баланс воды/.test(q('#details').textContent) && !/NaN/.test(q('#details').textContent));
{
  await wait(900);                     // окно открывается по таймеру через 1 с после старта
  const pop = popups[popups.length - 1];
  check('сброс: окно у плотины открыто', !!pop && !!q('#map .leaflet-popup'),
    'поповеров создано: ' + popups.length);
  const oy = pop ? (pop.options.offset[1] ?? null) : null;
  /* Leaflet цепляет контейнер за НИЖНИЙ край (style.bottom = -(y + offset.y)),
     поэтому «под маркером» = offset.y не меньше высоты самого окна */
  const h = pop && pop._container ? pop._container.getBoundingClientRect().height : 0;
  check('сброс: окно ПОД маркером (смещено на собственную высоту, а не вверх)',
    oy !== null && oy >= h && oy > 0, 'offset.y=' + oy + ' · высота окна=' + h);
  check('сброс: у окна перевёрнутый хвост (класс pop-under)',
    !!(pop && pop._container && /pop-under/.test(pop._container.className)),
    pop && pop._container && pop._container.className);
  check('сброс: позиция пересчитана Leaflet-ом (bottom = -(y + offset.y))',
    !!(pop && pop._container) &&
    Math.abs(parseFloat(pop._container.style.bottom) + (pop._map.latLngToLayerPoint(pop.getLatLng()).y + oy)) < 2,
    pop && pop._container && 'bottom=' + pop._container.style.bottom + ' · offset.y=' + oy);
  check('сброс: окно привязано к точке плотины',
    !!(pop && Math.abs(pop.getLatLng().lat - 60.67992) < 1e-3), pop && JSON.stringify(pop.getLatLng()));
}
check('сброс: анимация не роняет страницу', Date.now() - t0 > 1000 && errors.length === 0,
  'elapsed=' + (Date.now() - t0) + 'мс · ошибок: ' + errors.length);
click(q('.scenBtn[data-scen="normal"]'));
await wait(400);
check('сброс выключен: блок снят', qa('.hppItem:disabled').length === 0);
check('сброс выключен: окно плотины закрыто', !q('#map .leaflet-popup'),
  q('#map .leaflet-popup') ? 'поповер всё ещё на карте' : 'нет поповера');
check('сброс выключен: график вернулся на мощность',
  (chart('chartPowerC')?.data.datasets.length || 0) === 1 &&
  chart('chartPowerC').options.plugins.legend.display === false);

/* ---------- статус-окно: перетаскивание и возврат ---------- */
if (NARROW){
  /* на узких экранах статус-окно сознательно display:none (его роль играет
     #mobileBar), а makeDraggable там ничего не двигает — проверяем, что
     перетаскивание не оставляет «призрачной» позиции */
  check('на узком экране статус скрыт и не таскается',
    !q('#statusBar').classList.contains('dragging') && !q('#statusBar').style.left,
    'left=' + JSON.stringify(q('#statusBar').style.left));
} else {
  const sb = q('#statusBar');
  const rectBefore = { left: sb.style.left, top: sb.style.top };
  const pe = (type, x, y) => {
    const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    Object.defineProperty(ev, 'button', { value: 0 });
    return ev;
  };
  const r0 = sb.getBoundingClientRect();
  const grab = [r0.left + 30, r0.top + 8];
  sb.dispatchEvent(pe('pointerdown', grab[0], grab[1]));
  sb.dispatchEvent(pe('pointermove', grab[0] + 860, grab[1] + 330));
  sb.dispatchEvent(pe('pointerup', grab[0] + 860, grab[1] + 330));
  const saved = JSON.parse(window.__store.get('ges_layout_v1') || '{}').statusBar;
  check('статус-окно перетаскивается за любую точку кроме кнопки',
    sb.style.left !== rectBefore.left && sb.style.top !== rectBefore.top && !!saved,
    'inline: left=' + (sb.style.left || 'нет') + ' top=' + (sb.style.top || 'нет') + ' (тащили на +860/+330) ·' +
    ' · сохранено: ' + JSON.stringify(saved && { left: Math.round(saved.left), top: Math.round(saved.top), moveOnly: saved.moveOnly }));
  check('перетащенное окно не закреплено по размеру (текст статуса живой)',
    sb.style.width === '' && sb.style.height === '',
    'width=' + JSON.stringify(sb.style.width) + ' height=' + JSON.stringify(sb.style.height));
  check('окно осталось в пределах экрана (clamp)',
    saved && saved.left >= 8 && saved.top >= 8 &&
    saved.left + saved.w <= 1440 - 8 && saved.top + saved.h <= 900 - 8,
    saved && JSON.stringify({ l: Math.round(saved.left), t: Math.round(saved.top), w: Math.round(saved.w), h: Math.round(saved.h) }));

  /* за край экрана выпустить нельзя */
  sb.dispatchEvent(pe('pointerdown', grab[0], grab[1]));
  sb.dispatchEvent(pe('pointermove', 9000, 9000));
  sb.dispatchEvent(pe('pointerup', 9000, 9000));
  {
    const r = sb.getBoundingClientRect();
    const saved2 = JSON.parse(window.__store.get('ges_layout_v1') || '{}').statusBar;
    check('окно нельзя утащить за край экрана (clamp на отпускании)',
      !!saved2 && saved2.left + saved2.w <= 1440 - 8 && saved2.top + saved2.h <= 900 - 8 && saved2.left >= 8,
      saved2 ? 'left=' + Math.round(saved2.left) + ' top=' + Math.round(saved2.top) +
               ' (right=' + Math.round(r.right) + ')' : 'позиция не сохранена');
  }

  /* кнопка ⟳ внутри окна — не ручка перетаскивания */
  const rb = q('#refreshBtn');
  const before = sb.style.left;
  rb.dispatchEvent(pe('pointerdown', 1100, 200));
  rb.dispatchEvent(pe('pointermove', 800, 600));
  rb.dispatchEvent(pe('pointerup', 800, 600));
  check('⟳ не перетаскивает окно (клик по кнопке остаётся кликом)', sb.style.left === before,
    before + ' → ' + sb.style.left);

  /* двойной клик — возврат на место */
  const dbl = new window.MouseEvent('dblclick', { bubbles: true, cancelable: true });
  Object.defineProperty(dbl, 'target', { value: sb });
  sb.dispatchEvent(dbl);
  check('двойной клик возвращает окно в CSS-позицию',
    sb.style.left === '' && sb.style.top === '' && sb.style.position === '',
    'left=' + JSON.stringify(sb.style.left) + ' position=' + JSON.stringify(sb.style.position));
  check('после возврата запись о позиции удалена из ges_layout_v1',
    !JSON.parse(window.__store.get('ges_layout_v1') || '{}').statusBar,
    window.__store.get('ges_layout_v1'));
  check('манипуляции с окном не сломали статус',
    /history|forecast|climate|онлайн|офлайн|кэш/i.test(q('#statusText').textContent) &&
    !/NaN|undefined/.test(q('#statusText').textContent), q('#statusText').textContent.slice(0, 60));
}

/* ---------- зеркало водохранилища Перовской в сценариях ---------- */
{
  /* Карта при preferCanvas рисует полигоны в canvas — в DOM смотреть нечего,
     поэтому перехватываем сами L.polygon: аргументом идёт кольцо берега. */
  /* Состояние приложения — в глобальной ЛЕКСИЧЕСКОЙ области страницы:
     top-level const в обычном <script> не вешается на window, так что
     window.S / window.HPPS там нет, а window.eval('S') — есть */
  const evalApp = (src) => { try { return window.eval(src); } catch { return null; } };
  const PEROH = evalApp('HPPS.find(h => h.id === "pero")') || {};
  const polys = [];
  const origPoly = window.L.polygon;
  window.L.polygon = function(ll, o){ polys.push({ ll, o }); return origPoly.apply(this, arguments); };
  /* площадь полигона (шнуровка в локальных метрах) — bbox для этого не годится:
     концы русла закреплены, и при разливе растёт ширина, а не охватывающий
     прямоугольник */
  const polyArea = ll => {
    const ring = (Array.isArray(ll[0]?.[0]) ? ll[0] : ll).filter(pt => pt && isFinite(pt[0]));
    const k = Math.cos(ring.reduce((a, pt) => a + pt[0], 0) / ring.length * Math.PI / 180) * 111320;
    let A = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      A += (ring[j][1] * k + ring[i][1] * k) * (ring[j][0] - ring[i][0]) * 111320;
    }
    return Math.abs(A) / 2;
  };
  /* слой зеркала станции целиком (группа или один полигон) — кольцом наружу */
  /* листает не L.polygon-создание (при перемотке setLatLngs), поэтому кольцо
     читаем из живого слоя: weight 2 — вода, weight 1 + dashArray — граница НПВ */
  const liveShore = () => evalApp(`(() => {
    const o = S.reservoirs.pero;
    if (!o) return null;
    const ls = (o.getLayers ? o.getLayers().slice() : [o]);
    const flat = a => (!Array.isArray(a) || !a.length || !Array.isArray(a[0]) ? a : flat(a[0]));
    const pick = ls.filter(l => l.getLatLngs && l.options && l.options.weight === 2)[0]
      || ls.filter(l => l.getLatLngs && !(l.options && l.options.dashArray))[0];
    if (!pick) return null;
    const rr = flat(pick.getLatLngs());
    if (!rr || !rr.length) return null;
    return rr.map(pt => [pt.lat !== undefined ? pt.lat : pt[0], pt.lng !== undefined ? pt.lng : pt[1]]);
  })()`);
  const liveDashed = () => evalApp(`(() => {
    const o = S.reservoirs.pero;
    if (!o) return 0;
    return (o.getLayers ? o.getLayers().slice() : [o]).filter(l => l.options && l.options.dashArray).length;
  })()`) || 0;

  const snapshot = () => {
    const water = polys.filter(x => x.o.weight === 2 && x.o.fillOpacity > 0.2 && x.ll.length);
    const ring = liveShore();
    const dashed = liveDashed();
    const last = ring ? { ll: ring } : water[water.length - 1];

    const R = evalApp('S.results.pero') || {}, ix = evalApp('S.idx') || 0;
    const lvl = /Текущий уровень<\/span><span>([\d,.]+)/.exec(q('#details').innerHTML);
    return { ll: last ? last.ll : null,
             area: last ? polyArea(last.ll) : 0, dashed,
             level: lvl ? parseFloat(lvl[1].replace(',', '.').replace(/\s/g, '')) : NaN,
             water: water.length, txt: q('#details').textContent.replace(/\s+/g, ' '),
             /* чем рисует берег (shoreWidth) и что говорит модель (area/areaNMU) —
                ряды приложения: проверка «цифра ↔ геометрия» ниже опирается на них */
             sw: R.shoreWidth ? R.shoreWidth[ix] : null,
             mr: R.area && PEROH.areaNMU ? R.area[ix] / PEROH.areaNMU : null,
             lvlRaw: R.level ? R.level[ix] : null };
  };

  click(q('.hppItem[data-id="pero"]'));
  await wait(350);
  /* Снимаем на весеннем максимуме ряда: на межени «засухе» некуда сжиматься,
     и проверка «разницу видно» превратилась бы в проверку предела чаши */
  const iMax = evalApp(`(() => { const l = (S.results.pero || {}).level || []; let b = 0;
    for (let i = 0; i < l.length; i++) if (isFinite(l[i]) && l[i] > (l[b] || -Infinity)) b = i;
    return b; })()`) || 0;
  {
    const sl = q('#slider');
    if (sl && iMax > 0){
      sl.value = String(iMax);
      sl.dispatchEvent(new window.Event('input', { bubbles: true }));
      await wait(700);
    }
  }
  const per = {};
  for (const sc of ['normal', 'flood', 'drought', 'normal']){
    polys.length = 0;
    click(q(`.scenBtn[data-scen="${sc}"]`));
    await wait(500);
    per[sc] = snapshot();
    if (process.env.SMOKE_DEBUG) console.log('   dbg', sc, JSON.stringify({
      scen: evalApp('S.scenario'), mode: evalApp('S.mode'),
      water: evalApp('S.results.pero && S.results.pero.scenarioWater'),
      shoreWidth: evalApp('S.results.pero && S.results.pero.shoreWidth.slice(-1)'),
      dh: evalApp('S.results.pero && S.results.pero.shoreDh.slice(-1)'),
      lv: evalApp('S.results.pero && S.results.pero.level.slice(-1)'),
      area: evalApp('S.results.pero && S.results.pero.area.slice(-1)'),
      idx: evalApp('S.idx')
    }));
  }
  /* перехват держим до конца блока (в т.ч. до секции климата): snapshot()
     читает ровно этот polys, поэтому и климат снимаетmirror отсюда */

  /* срез строк карточки для диагнозов — объявляем до первого использования */
  const row = (o) => ['Площадь берегового контура', 'Поправка «'].map(k => {
      const j = o.txt.indexOf(k);
      return j < 0 ? '—' : o.txt.slice(j, j + 70).trim();
    }).join(' // ');

  check('сценарии перерисовывают береговой полигон', per.flood.water > 0 && per.drought.water > 0,
    'полигонов: ' + JSON.stringify({ n: per.normal.water, f: per.flood.water, d: per.drought.water }));
  const ratioF = per.normal.area ? per.flood.area / per.normal.area : 0;
  const ratioD = per.normal.area ? per.drought.area / per.normal.area : 0;
  check('«Паводок»: зеркало разлилось шире контура НПВ', ratioF > 1.08,
    'площадь ×' + ratioF.toFixed(3) + ' (' + (per.normal.area / 1e4).toFixed(2) + ' → ' + (per.flood.area / 1e4).toFixed(2) + ' га)');
  check('«Засуха»: вода отступила внутрь контура НПВ', ratioD < 0.85,
    'площадь ×' + ratioD.toFixed(3) + ' (' + (per.normal.area / 1e4).toFixed(2) + ' → ' + (per.drought.area / 1e4).toFixed(2) + ' га)');
  /* Граница НПВ — про «вода отступила ВНУТРЬ снимка», поэтому она обязана
     появляться и в «норме», если ряд модели ниже НПВ (режим климата, межень) */
  const below = (o) => o.level < (PEROH.nmu - 0.1);
  check('при отступлении воды рисуется пунктирная граница НПВ (и в «норме» на межени)',
    per.drought.dashed > 0 && per.flood.dashed > 0 &&
    per.normal.dashed === (below(per.normal) ? 1 : 0),
    'пунктиров: ' + JSON.stringify({ n: per.normal.dashed, f: per.flood.dashed, d: per.drought.dashed }) +
    ' · норма ' + per.normal.level + ' м при НПУ ' + PEROH.nmu + ' м');
  check('отметка уровня в карточке реагирует на сценарий',
    per.flood.level >= per.normal.level && per.drought.level < per.normal.level,
    'засуха ' + per.drought.level + ' · норма ' + per.normal.level + ' · паводок ' + per.flood.level);
  const pct = (o) => { const m = /% снимка при НПВ/.test(o.txt)
      ? +(o.txt.replace(',', '.').match(/(\d+)\s*% снимка при НПВ/) || [0, 0])[1] : 100;
    return m; };
  /* «не только цвет, но и размер»: цифра модели, множитель берега и НАРИСОВАННАЯ
     доля снимка при НПВ — три имени одной величины. Кривые area() и геометрия
     нарочно замкнуты, иначе карточка и контур расходятся (на этом и попадалось) */
  {
    const A0 = polyArea(window.RESERVOIR_GEOMETRY.pero.n[0]);
    const clamp = v => Math.min(1.5, Math.max(0.3, v));
    const rows = ['normal', 'flood', 'drought'].map(k => {
      const o = per[k], drawn = A0 ? o.area / A0 : 0, ref = pct(o) / 100;
      return { k, drawn, pct: ref, sw: o.sw, mr: o.mr,
               ok: o.area > 0 && Math.abs(drawn - ref) < 0.12 &&
                   typeof o.sw === 'number' && o.sw >= 0.2 - 1e-9 && o.sw <= 1.5 + 1e-9 };
    });
    check('площадь берегового контура в карточке = нарисованная доля снимка при НПВ',
      rows.every(r => r.ok),
      rows.map(r => r.k + ': рисунок ' + (r.drawn * 100).toFixed(0) + '% · карточка ' +
        (r.pct * 100).toFixed(0) + '% · shoreWidth ' + (r.sw == null ? '—' : r.sw.toFixed(2)) +
        ' (доля площади модели ' + (r.mr == null ? '—' : (clamp(r.mr) * 100).toFixed(0) + '%)')).join(' || '));
  }

  /* ── ГЕОМЕТРИЯ: «не съезжает» ── вода при сработке держится створа и не
     вылезает за чашу. Метры — локальные (долгота сжата cos широты). */
  const METRES = 111320, DAM = [60.67992, 28.95119];
  const bowl = window.RESERVOIR_GEOMETRY.pero.n[0];
  const kFrame = Math.cos(bowl.reduce((a, p) => a + p[0], 0) / bowl.length * Math.PI / 180);
  const toM = (p) => [p[1] * kFrame * METRES, p[0] * METRES];
  const bowlM = bowl.map(toM);
  const pip = (r, p) => { let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++){
      if (((r[i][1] > p[1]) !== (r[j][1] > p[1])) &&
          p[0] < (r[j][0] - r[i][0]) * (p[1] - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
    } return inside; };
  const distToBowl = (p) => { let bd = Infinity;
    for (let i = 0, j = bowlM.length - 1; i < bowlM.length; j = i++){
      const ax = bowlM[j][0], ay = bowlM[j][1];
      const vx = bowlM[i][0] - ax, vy = bowlM[i][1] - ay;
      const l = vx * vx + vy * vy; let t = l > 0 ? ((p[0] - ax) * vx + (p[1] - ay) * vy) / l : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      bd = Math.min(bd, Math.hypot(ax + vx * t - p[0], ay + vy * t - p[1]));
    } return bd; };
  const stat = (o) => {
    const raw = o.ll || [];
    const ll = Array.isArray(raw[0]?.[0]) ? raw[0] : raw;
    const pts = ll.filter(p => p && isFinite(p[0]));
    const xy = pts.map(toM);
    const damM = toM(DAM);
    let out = 0, worst = 0;
    for (const p of xy) if (!pip(bowlM, p)){
      const d = distToBowl(p);          /* на самой границе point-in-ring неопределён — считаем вылет */
      if (d > 0.5){ out++; worst = Math.max(worst, d); }
    }
    return { near: Math.min(...pts.map(p => Math.hypot(...toM(p).map((v, i) => v - damM[i])))),
             out, worst, n: pts.length };
  };
  const st = {};
  for (const sc of ['normal', 'flood', 'drought']) st[sc] = stat(per[sc]);
  /* петли и «шипы» — то, что было на скриншоте: кольцо обязано оставаться простым */
  const loops = (o) => {
    const raw = o.ll || [];
    const ll = (Array.isArray(raw[0]?.[0]) ? raw[0] : raw).filter(p => p && isFinite(p[0]));
    let n = 0;
    for (let i = 0; i < ll.length; i++){
      const a1 = toM(ll[i]), b1 = toM(ll[(i + 1) % ll.length]);
      for (let j = i + 2; j < ll.length; j++){
        if (i === 0 && j === ll.length - 1) continue;
        const c1 = toM(ll[j]), d1 = toM(ll[(j + 1) % ll.length]);
        const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
        if (side(a1, b1, c1) * side(a1, b1, d1) < 0 && side(c1, d1, a1) * side(c1, d1, b1) < 0) n++;
      }
    }
    return n;
  };
  check('берег не рвётся на петли и шипы (кольцо простое)',
    loops(per.normal) === 0 && loops(per.flood) === 0 && loops(per.drought) === 0,
    'петель: ' + ['normal','flood','drought'].map(k => k + ' ' + loops(per[k])).join(' · '));
  check('берег держится плотины (концы русла закреплены, «съезда» нет)',
    st.normal.near < 25 && st.flood.near < 25 && st.drought.near < 25,
    'ближайшая вершина к створу: ' + ['normal','flood','drought'].map(k => k + ' ' + st[k].near.toFixed(0) + 'м').join(' · '));
  check('засуха: вода остаётся внутри реального контура (не «съезжает»)',
    st.drought.out === 0,
    'вершин вне чаши: ' + st.drought.out + ' из ' + st.drought.n + ' · максимальный вылет ' +
    st.drought.worst.toFixed(1) + 'м');
  check('паводок: берег жмётся к створу, а не уплывает вниз по руслу',
    st.flood.near <= st.normal.near + 6 && st.drought.near <= st.normal.near + 6,
    'створ: норма ' + st.normal.near.toFixed(0) + 'м · паводок ' + st.flood.near.toFixed(0) +
    'м · засуха ' + st.drought.near.toFixed(0) + 'м');
  /* карточка: в «норме» строки про поправку нет и быть не должно, поэтому
     смотрим текст снимка паводка/засухи */
  check('карточка объясняет поправку',
    /Площадь берегового контура/.test(per.drought.txt) && /Поправка «маловодный год»/.test(per.drought.txt) &&
    /Поправка «многоводный год»/.test(per.flood.txt) && !/Поправка «/.test(per.normal.txt),
    'засуха: ' + row(per.drought) + ' || паводок: ' + row(per.flood));
  check('зеркало менялось без ошибок страницы', errors.length === 0, errors.slice(0, 1).join(''));
  /* ── режим КЛИМАТ: зеркало обязано менять РАЗМЕР, а не только цвет ── */
  {
    click(q('#modeTabs button[data-mode=\"climate\"]'));
    await wait(2600);
    const seen = [];
    for (const frac of [0.30, 0.42, 0.55, 0.68, 0.80, 0.93]){
      const sl = q('#slider');
      sl.value = String(Math.round(+sl.max * frac));
      sl.dispatchEvent(new window.Event('input', { bubbles: true }));
      await wait(200);
      await wait(320);
      const o = snapshot();
      seen.push({ frac, area: o.area, dashed: o.dashed, txt: o.txt, level: o.level,
                  sw: o.sw, mr: o.mr, lvlRaw: o.lvlRaw, idx: evalApp('S.idx') });
      if (process.env.SMOKE_DEBUG) console.log('   dbg clima', frac, JSON.stringify(seen[seen.length-1]));
      if (process.env.SMOKE_DEBUG) console.log('   dbg S', JSON.stringify({
        scen: evalApp('S.scenario'), mode: evalApp('S.mode'), water: evalApp('S.results.pero && S.results.pero.scenarioWater'),
        lv: evalApp('S.results.pero && S.results.pero.level.slice(-1)'),
        sw: evalApp('S.results.pero && S.results.pero.shoreWidth.slice(-1)') }));
    }
    window.L.polygon = origPoly;
    const areas = seen.map(x => x.area).filter(x => x > 0);
    const amax = Math.max(...areas), amin = Math.min(...areas);
    check('в режиме климата зеркало меняет РАЗМЕР по ряду (не только цвет)',
      amin > 0 && amax / amin > 1.08, 'площадь га: ' + areas.map(x => (x / 1e4).toFixed(2)).join(' · ') +
      ' · размах ×' + (amax / (amin || 1)).toFixed(2));
    check('бегунок климата двигает ряд (индекс не стоит на месте)',
      new Set(seen.map(x => x.idx)).size >= 4, 'idx: ' + seen.map(x => x.idx).join(','));
    /* берег в «норме» = monotone(f) от отметки ряда: выше вода — шире зеркало */
    const byLvl = seen.slice().sort((a, b) => (a.lvlRaw ?? 0) - (b.lvlRaw ?? 0));
    check('множитель берега монотонен по отметке ряда (выше вода — шире зеркало)',
      byLvl.every((x, i) => i === 0 || x.sw == null || x.sw >= byLvl[i-1].sw - 1e-9),
      'отметка→shoreWidth: ' + byLvl.map(x => (x.lvlRaw ?? NaN).toFixed(2) + '→' + (x.sw ?? NaN).toFixed(2)).join(' · '));
    check('карточка догоняет бегунок: уровень в ней = уровень ряда на эту дату',
      seen.every(x => !isFinite(x.lvlRaw) || Math.abs(x.level - x.lvlRaw) < 0.35),
      seen.map(x => 'карточка ' + x.level + ' м · ряд ' + (x.lvlRaw ?? NaN).toFixed(2) + ' м').join(' · '));
    check('в «норме» зеркало держится в чаше (0,2…1,5 доли снимка при НПВ)',
      seen.every(x => x.sw == null || (x.sw >= 0.2 - 1e-9 && x.sw <= 1.5 + 1e-9)),
      'shoreWidth: ' + seen.map(x => (x.sw ?? NaN).toFixed(2)).join(' · '));
    const low = seen.slice().sort((x, y) => x.area - y.area)[0];
    check('на низкой межени климата рисуется граница НПВ и объяснение в карточке',
      low.dashed > 0 && /Отметка ниже НПУ/.test(low.txt) && /% снимка при НПВ/.test(low.txt),
      'пунктиров: ' + low.dashed + ' · ' + (low.txt.match(/Отметка ниже НПУ[^·]{0,46}/) || ['—'])[0].trim());
    check('в климате уровень карточки и размер зеркала не противоречат друг другу',
      /* ряд отметок берём из S (карточка перерисовывается с дебаунсом),
         размер — с нарисованного кольца: низкая вода не обязана стоять полным прудом */
      seen.every(x => {
        const rel = x.area / (amax || 1), lvl = x.lvlRaw;
        if (!isFinite(lvl)) return true;
        return !((lvl < PEROH.nmu - 0.1) && rel > 0.995) && !((lvl > PEROH.nmu - 0.05) && rel < 0.9);
      }),
      seen.map(x => x.level + 'м→×' + (x.area / (amax || 1)).toFixed(2) +
        (x.sw != null ? ' (shoreWidth ' + x.sw.toFixed(2) + ')' : '')).join(' · '));
    check('климатическое зеркало менялось без ошибок', errors.length === 0, errors.slice(0, 1).join(''));
    click(q('#modeTabs button[data-mode=\"history\"]'));
    await wait(1800);
  }
}


/* ---------- лента прорыва на Роккаланмяки: по руслу, а не по полям ---------- */
{
  const polys2 = [];
  const orig2 = window.L.polygon;
  window.L.polygon = function(ll, o){ polys2.push({ ll, o }); return orig2.apply(this, arguments); };
  click(q('.hppItem[data-id=\"rokk\"]'));
  await wait(900);
  click(q('.scenBtn[data-scen=\"dam_break\"]'));
  /* зона затопления растёт вместе с фронтом: снимать «меандры» надо в конце
     прогона, иначе в ленте всего пара сотен метров и они почти прямые */
  await wait(11000);
  window.L.polygon = orig2;
  const rings = polys2.filter(x => Array.isArray(x.ll) && x.ll.length > 30 &&
    x.ll.every(pt => pt && isFinite(pt[0]) && isFinite(pt[1])));
  /* финальная зона затопления (пунктир #ff9400) — она перерисовывается на весь
     затопленный участок; полигон последнего кадра волны короткая, по ней про
     меандры судить нельзя */
  const foot = rings.filter(x => x.o.color === '#ff9400' && x.o.dashArray).pop();
  const band = foot || rings[rings.length - 1];
  const course = window.RIVER_COURSES.rokk;
  const lat = 60.2913, kx = 111320 * Math.cos(lat * Math.PI / 180);
  const toM = pt => [pt[1] * kx, pt[0] * 110574];
  const cM = course.map(toM);
  const distCourse = (p) => {
    let best = Infinity;
    for (let i = 1; i < cM.length; i++){
      const [ax, ay] = cM[i-1], [bx, by] = cM[i];
      const dx = bx-ax, dy = by-ay, l2 = dx*dx + dy*dy;
      let t = l2 ? ((p[0]-ax)*dx + (p[1]-ay)*dy)/l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(p[0]-(ax+t*dx), p[1]-(ay+t*dy)));
    }
    return best;
  };
  let far = 0, worst = 0, width = 0;
  if (band){
    const xy = band.ll.map(toM);
    for (const p of xy){ const d = distCourse(p); if (d > 45){ far++; worst = Math.max(worst, d); } }
    /* «ширина» ленты — размах вершин поперёк русла, по трём точкам ряда */
    width = Math.max(...xy.map(p => distCourse(p)));
  }
  check('лента прорыва на Роккаланмяки лежит НА русле (не срезает меандры)',
    !!band && far === 0, band ? ('вершин дальше 45 м от воды: ' + far + ' из ' + band.ll.length +
    ' · максимальный вылет ' + worst.toFixed(0) + ' м') : 'лента не найдена');
  check('поперёк русла лента не толще самой реки более чем на 25 м',
    !!band && width <= 25, 'макс. отстояние вершины от оси: ' + (width || 0).toFixed(1) + ' м');
  /* лента обязана ИДТИ по излучинам, а не перерезать их хордой (претензия по
     скриншоту: оранжевый прямоугольник через поля). Меряем отношением длины
     средней линии ленты к расстоянию между её концами: у русла здесь ×1.17-1.28 */
  {
    const xy = band ? band.ll.map(toM) : [];
    const half = Math.floor(xy.length / 2);
    const chain = [...xy.slice(0, half), ...xy.slice(xy.length - 1, half - 1, -1)];
    let arc = 0;
    for (let i = 1; i < chain.length; i++) arc += Math.hypot(chain[i][0]-chain[i-1][0], chain[i][1]-chain[i-1][1]);
    const chord = xy.length > 2 ? Math.hypot(xy[0][0]-xy[half][0], xy[0][1]-xy[half][1]) : 1;
    check('лента следует меандрам, а не перерезает их хордой',
      !!band && chord > 0 && arc / chord > 1.02,
      band ? (foot ? 'зона затопления' : 'кадр волны') + ' · путь по ленте ' + Math.round(arc) +
              ' м против хорды ' + Math.round(chord) + ' м · ×' + (arc / (chord || 1)).toFixed(3) +
              ' · вершин ' + band.ll.length : 'лента не найдена');
  }
  click(q('.scenBtn[data-scen=\"reset\"]'));
  await wait(400);
  click(q('.hppItem[data-id=\"pero\"]'));
  await wait(700);
  check('лента прорыва без ошибок страницы', errors.length === 0, errors.slice(0, 1).join(''));
}

/* ---------- смена режима ---------- */
click(q('#modeTabs button[data-mode="forecast"]'));
await wait(2500);
check('режим «Прогноз» переключился без ошибок', errors.length === 0 &&
  /forecast|прогноз|онлайн|офлайн|кэш/i.test(q('#statusText').textContent),
  q('#statusText').textContent.slice(0, 70));
check('после смены режима график не пустой', (chart('chartPowerC')?.data.datasets[0]?.data.length || 0) > 5,
  chart('chartPowerC')?.data.datasets[0]?.data.length);
click(q('#modeTabs button[data-mode="history"]'));
await wait(2000);

/* ---------- UI-мелочи, которые ломались вместе с boot() ---------- */
q('#map').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
click(q('#panelToggle'));
await wait(120);
click(q('#panelToggle'));
check('тумблер панелей и Esc не валят страницу', errors.length === 0, errors.slice(0, 1).join(''));

/* ---------- плашка «Доступна новая версия» ---------- */
{
  const btn = q('#updateReady');
  check('плашка обновления скрыта по умолчанию', btn.hidden === true);
  /* случай 1: обычный — install сам вызывает skipWaiting (см. sw.js), а оболочка
     отдаётся network-first → перезагрузка не нужна, кнопка показывать нечего */
  window.__sw.settledInstalled();
  await wait(2000);
  check('после штатной активации SW кнопка НЕ появляется', q('#updateReady').hidden === true,
    'waiting=' + JSON.stringify(window.__sw.reg.waiting) + ' · posts=' + window.__sw.posts.length);

  /* случай 2: воркер реально застрял в waiting */
  window.__sw.stuckWaiting();
  await wait(2000);
  check('если SW застрял в waiting — кнопка появляется', q('#updateReady').hidden === false);

  /* клик: сначала skipWaiting сообщением, затем ровно одна перезагрузка
     (перехватить location.reload() в jsdom нельзя — он непереназначаем,
     поэтому сигналом служит попытка навигации) */
  check('перезагрузка не вызвана без нужды', navAttempts === 0, 'навигаций: ' + navAttempts);
  q('#updateReady').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(120);
  check('клик передаёт управление новому воркеру (postMessage skipWaiting)',
    window.__sw.posts[0] === 'skipWaiting', JSON.stringify(window.__sw.posts));
  check('клик прячет плашку сразу', q('#updateReady').hidden === true);
  await wait(800);
  check('страница перезагружается ровно один раз', navAttempts === 1, 'навигаций: ' + navAttempts);
  window.__sw.swTarget.fire('controllerchange');
  await wait(120);
  check('controllerchange не зацикливает перезагрузку', navAttempts === 1, 'навигаций: ' + navAttempts);
  window.__sw.posts.length = 0;
}

console.log('\n— console.error / window errors —');
console.log(errors.length ? [...new Set(errors)].slice(0, 6).join('\n') : 'нет');
console.log('\n— предупреждения (уникальные, первые 6) —');
console.log([...new Set(warns)].slice(0, 6).join('\n') || 'нет');
clearTimeout(watchdog);
console.log('\nИТОГО провалов: ' + failed);
dom.window.close();
process.exit(failed ? 1 : 0);
