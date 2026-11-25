/* Стенд «как в браузере»: index.html в jsdom с НАСТОЯЩИМИ Leaflet и Chart.js.
   Зачем: node --check и юнит-тесты не видят поломки вроде `type:'line'` не в
   том месте конфига Chart.js — конструктор тогда не падает, а ломается первая
   же отрисовка, и из одного пропуска вырастает «пустые графики + мёртвая
   перемотка + лагающий сброс». Этот прогон поднимает страницу целиком и
   проверяет 37 сценарных шагов.

   Запуск (зависимости не входят в репозиторий — стенд dev-инструмент):
     npm i --no-save jsdom leaflet@1.9.4 chart.js@4.4.1
     npm run smoke
     SMOKE_OFFLINE=1 npm run smoke                      # сеть падает
     SMOKE_NARROW=1 SMOKE_MOTION=reduce npm run smoke   # узкий экран + меньше движения
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

const errors = [];
const warns = [];
/* коротко: дамп минифицированного chart.umd.js/leaflet.js только заглушает вывод */
const brief = e => String((e && (e.stack || e.message)) || e).split('\n')
  .filter(l => !/chart\.umd|leaflet\.js|runtime-script-errors|EventTarget-impl|Window\.js/.test(l))
  .slice(0, 3).join(' | ');
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + brief(e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ').slice(0, 200)));
vc.on('warn', (...a) => warns.push(a.join(' ')));
process.on('uncaughtException', e => errors.push('uncaught: ' + brief(e)));
process.on('unhandledRejection', e => errors.push('rejection: ' + brief(e)));

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

    try { delete window.navigator.serviceWorker; } catch(e){}
    Object.defineProperty(window, 'innerWidth', { value: NARROW ? 420 : 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: NARROW ? 780 : 900, configurable: true });
    window.matchMedia = q => ({
      matches: /max-width:\s*900px/.test(q) ? NARROW : /prefers-reduced-motion/.test(q) ? REDUCE : false,
      media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}
    });
    window.Element.prototype.getBoundingClientRect = function(){
      const w = this.id === 'sidebar' ? 330 : this.id === 'chartPanel' ? 450 : 240;
      return { left: 12, top: 64, right: 12 + w, bottom: 300, width: w, height: 236, x: 12, y: 64 };
    };
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
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
check('панель графиков показана', q('#chartPanel').classList.contains('show'));
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
check('сброс: анимация не роняет страницу', Date.now() - t0 > 1000 && errors.length === 0,
  'elapsed=' + (Date.now() - t0) + 'мс · ошибок: ' + errors.length);
click(q('.scenBtn[data-scen="normal"]'));
await wait(400);
check('сброс выключен: блок снят', qa('.hppItem:disabled').length === 0);
check('сброс выключен: график вернулся на мощность',
  (chart('chartPowerC')?.data.datasets.length || 0) === 1 &&
  chart('chartPowerC').options.plugins.legend.display === false);

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

console.log('\n— console.error / window errors —');
console.log(errors.length ? [...new Set(errors)].slice(0, 6).join('\n') : 'нет');
console.log('\n— предупреждения (уникальные, первые 6) —');
console.log([...new Set(warns)].slice(0, 6).join('\n') || 'нет');
console.log('\nИТОГО провалов: ' + failed);
dom.window.close();
process.exit(failed ? 1 : 0);
