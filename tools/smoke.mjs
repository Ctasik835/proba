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

const LAT = [60.768, 60.71815, 60.67992, 60.52897, 60.2913, 60.6077];
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
check('прорыв: без ошибок', errors.length === 0, errors.slice(0, 1).join(''));
click(q('.scenBtn[data-scen="reset"]'));
await wait(400);

/* ---------- учебный сброс ---------- */
/* подглядываем за созданием поповера: L.popup возвращает объект, у которого
   потом проверяем offset (именно он отвечает «над маркером окно или под») */
const popups = [];
{
  const orig = window.L.popup;
  window.L.popup = function(...a){ const p = orig.apply(this, a); popups.push(p); return p; };
}
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
  const polys = [];
  const origPoly = window.L.polygon;
  window.L.polygon = function(ll, o){ polys.push({ ll, o }); return origPoly.apply(this, arguments); };
  const bboxArea = ll => {
    const ring = Array.isArray(ll[0]?.[0]) ? ll[0] : ll;
    const la = ring.map(pt => pt[0]), lo = ring.map(pt => pt[1]);
    return (Math.max(...la) - Math.min(...la)) * (Math.max(...lo) - Math.min(...lo));
  };
  const snapshot = () => {
    const water = polys.filter(x => x.o.weight === 2 && x.o.fillOpacity > 0.2 && x.ll.length);
    const dashed = polys.filter(x => x.o.dashArray && x.o.weight === 1);
    const last = water[water.length - 1];

    const lvl = /Текущий уровень<\/span><span>([\d,.]+)/.exec(q('#details').innerHTML);
    return { ll: last ? last.ll : null,
             area: last ? bboxArea(last.ll) : 0, dashed: dashed.length,
             level: lvl ? parseFloat(lvl[1].replace(',', '.').replace(/\s/g, '')) : NaN,
             water: water.length, txt: q('#details').textContent.replace(/\s+/g, ' ') };
  };

  click(q('.hppItem[data-id="pero"]'));
  await wait(350);
  const per = {};
  for (const sc of ['normal', 'flood', 'drought', 'normal']){
    polys.length = 0;
    click(q(`.scenBtn[data-scen="${sc}"]`));
    await wait(500);
    per[sc] = snapshot();
    if (process.env.SMOKE_DEBUG) console.log('   dbg', sc, JSON.stringify({
      scen: window.S.scenario, active: window.S.active,
      water: window.S.results.pero?.scenarioWater,
      scales: window.S.results.pero?.shoreScale?.slice(-1),
      lv: window.S.results.pero?.level?.slice(-1),
      factor: window.GES.scenarioFactor(window.HYDRO_LOGS.pero, new Date('2026-06-15T00:00:00Z'), sc),
      hpp: !!window.HYDRO_LOGS.pero.hpp,
    }));
  }
  window.L.polygon = origPoly;

  /* срез строк карточки для диагнозов — объявляем до первого использования */
  const row = (o) => ['Площадь берегового контура', 'Поправка «'].map(k => {
      const j = o.txt.indexOf(k);
      return j < 0 ? '—' : o.txt.slice(j, j + 70).trim();
    }).join(' // ');

  check('сценарии перерисовывают береговой полигон', per.flood.water > 0 && per.drought.water > 0,
    'полигонов: ' + JSON.stringify({ n: per.normal.water, f: per.flood.water, d: per.drought.water }));
  const ratioF = per.normal.area ? per.flood.area / per.normal.area : 0;
  const ratioD = per.normal.area ? per.drought.area / per.normal.area : 0;
  check('«Паводок»: зеркало разлилось шире контура НПВ', ratioF > 1.03,
    'bbox ×' + ratioF.toFixed(3) + ' (' + per.normal.area.toFixed(8) + ' → ' + per.flood.area.toFixed(8) + ')');
  check('«Засуха»: вода отступила внутрь контура НПВ', ratioD < 0.93,
    'bbox ×' + ratioD.toFixed(3));
  check('при отступлении воды рисуется пунктирная граница НПВ',
    per.drought.dashed > 0 && per.flood.dashed > 0 && per.normal.dashed === 0,
    'пунктиров: ' + JSON.stringify({ n: per.normal.dashed, f: per.flood.dashed, d: per.drought.dashed }));
  check('отметка уровня в карточке реагирует на сценарий',
    per.flood.level >= per.normal.level && per.drought.level < per.normal.level,
    'засуха ' + per.drought.level + ' · норма ' + per.normal.level + ' · паводок ' + per.flood.level);
  const pct = (o) => { const m = /% снимка при НПВ/.test(o.txt)
      ? +(o.txt.replace(',', '.').match(/(\d+)\s*% снимка при НПВ/) || [0, 0])[1] : 100;
    return m; };
  check('площадь контура в карточке = площадь нарисованной фигуры',
    pct(per.flood) > 100 && pct(per.drought) > 0 && pct(per.drought) < 60 &&
    per.normal.txt.indexOf('км² · снимок при НПВ') > 0,
    'норма/паводок/засуха: ' + pct(per.normal) + '% / ' + pct(per.flood) + '% / ' + pct(per.drought) + '%');

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
  check('берег не отрывается от плотины (якорь у створа)',
    st.normal.near < 25 && st.flood.near < 25 && st.drought.near < 25,
    'ближайшая вершина к створу: ' + ['normal','flood','drought'].map(k => k + ' ' + st[k].near.toFixed(0) + 'м').join(' · '));
  check('засуха: вода остаётся внутри реального контура (не «съезжает»)',
    st.drought.out === 0,
    'вершин вне чаши: ' + st.drought.out + ' из ' + st.drought.n + ' · максимальный вылет ' +
    st.drought.worst.toFixed(1) + 'м');
  check('паводок: берег жмётся к створу, а не уплывает вниз по руслу',
    st.flood.near <= st.normal.near + 5 && st.drought.near <= st.normal.near + 5,
    'створ: норма ' + st.normal.near.toFixed(0) + 'м · паводок ' + st.flood.near.toFixed(0) +
    'м · засуха ' + st.drought.near.toFixed(0) + 'м');
  /* карточка: в «норме» строки про поправку нет и быть не должно, поэтому
     смотрим текст снимка паводка/засухи */
  check('карточка объясняет поправку',
    /Площадь берегового контура/.test(per.drought.txt) && /Поправка «маловодный год»/.test(per.drought.txt) &&
    /Поправка «многоводный год»/.test(per.flood.txt) && !/Поправка «/.test(per.normal.txt),
    'засуха: ' + row(per.drought) + ' || паводок: ' + row(per.flood));
  check('зеркало менялось без ошибок страницы', errors.length === 0, errors.slice(0, 1).join(''));
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
