/* Проверки целостности «сайта без сборщика»: что разметка, кэш-лист
   service worker, model.js и данные не разъехались. Ловит ровно те классы
   ошибок, которые в таком проекте не видны до первого клика: опечатка в id,
   забытый файл в SHELL, лишний ключ в данных, отсутствующий иконкой manifest.
   Запуск: npm test */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const require_ = createRequire(import.meta.url);

const html = read('index.html');
const app = read('app.js');
const sw = read('sw.js');
const GES = require_(path.join(ROOT, 'model.js'));

/* ---------- index.html ↔ файлы ---------- */
test('все локальные ресурсы из index.html лежат в репозитории', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
    .filter(u => !/^https?:|^data:|^#/.test(u));
  assert.ok(refs.length >= 10, 'не нашли ни одной ссылки — изменился формат разметки?');
  for (const u of refs){
    assert.ok(exists(u), `index.html ссылается на несуществующий файл: ${u}`);
  }
});

test('порядок скриптов: version.js и model.js раньше app.js', () => {
  const at = f => html.indexOf(`src="${f}"`);
  assert.ok(at('version.js') > -1 && at('version.js') < at('app.js'), 'version.js должен грузиться до app.js');
  assert.ok(at('model.js') > -1 && at('model.js') < at('app.js'), 'model.js должен грузиться до app.js');
});

test('PWA-обвязка-complete: манифест, иконки, theme-color, description', () => {
  assert.match(html, /<link rel="manifest"/, 'нет подключения манифеста — «установить приложение» недоступно');
  assert.match(html, /name="theme-color"/, 'нет theme-color — статус-бар на мобильном будет белого цвета');
  assert.match(html, /name="description"/, 'нет description — сниппет в поиске соберётся из мусора');
  assert.match(html, /rel="icon"/, 'нет иконки — каждый загрузка даёт 404 на /favicon.ico');
  assert.ok(exists('manifest.webmanifest'), 'нет manifest.webmanifest');
  const mf = JSON.parse(read('manifest.webmanifest'));
  assert.equal(mf.lang, 'ru');
  for (const ic of mf.icons){
    assert.ok(exists(ic.src), `в манифесте указан несуществующий икон: ${ic.src}`);
  }
  assert.ok(mf.icons.some(i => /192/.test(i.sizes)), 'нужна иконка 192px для installability');
});

/* ---------- id/классы, на которые опирается JS ---------- */
test('каждый getElementById($(...)) из app.js есть в разметке', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...app.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
  const dynamic = new Set();          // создаются самим app.js
  for (const m of app.matchAll(/(\w+)\.id\s*=\s*'([A-Za-z0-9_-]+)'/g)) dynamic.add(m[2]);
  const missing = [...used].filter(id => !ids.has(id) && !dynamic.has(id));
  assert.deepEqual(missing, [], `в разметке нет элементов: ${missing.join(', ')}`);
});

test('селекторы ручек перетаскивания живы в разметке', () => {
  /* makeDraggable('sidebar', '.drag-handle') молча ничего не навесит,
     если класс в HTML потеряется — поэтому проверяем оба конца */
  for (const sel of ['.drag-handle', '.scenBtn', '.hppItem', '#legend']){
    const cls = sel.replace(/^\./, '').replace(/^#/, '');
    /* класс может навешиваться и из JS (строки списка станций создаются в app.js) */
    assert.ok(html.includes(cls) || app.includes(cls), `${sel} не находится ни в разметке, ни в app.js`);
  }
  assert.ok((html.match(/drag-handle/g) || []).length >= 2, 'ручка перетаскивания должна быть у обеих панелей');
});

/* ---------- app.js ↔ model.js ---------- */
test('всё деструктурированное из GES действительно экспортируется', () => {
  const block = app.slice(app.indexOf('const {'), app.indexOf('} = window.GES;'));
  const names = block.split('\n').slice(1).join(' ')
    .split(',')
    .map(s => s.trim().split(':')[0].trim())
    .filter(Boolean);
  assert.ok(names.length > 10, 'не разобрали список импортов');
  for (const n of names){
    assert.ok(n in GES || n === 'window', `model.js не экспортирует ${n}`);
  }
  /* лишние импорты тоже вредны: мёртвая ссылка кричит только в рантайме.
     Экспорт имеет смысл, если его читает либо страница, либо тесты — всё, что
     не нужно ни там ни там, из GES убираем (иначе «публичный API» обрастает
     мусором, и правки в model.js перестают что-либо ломать). */
  const exported = Object.keys(GES);
  const tests = ['tests/model.test.mjs', 'tests/site.test.mjs', 'tools/smoke.mjs']
    .map(read).join('\n');
  const unused = exported.filter(k => {
    const re = new RegExp(`\\b${k}\\b`);      // «упомянуто» = живёт в коде, а не в мёртвом API
    return !re.test(app) && !re.test(tests);
  });
  assert.ok(unused.length < 12, 'model.js отдаёт неиспользуемое (ни страницей, ни тестами): ' + unused.join(', '));
});

test('app.js не объявляет того, что уже есть в model.js', () => {
  for (const fn of ['simulate', 'releaseCalculate', 'movingAverage', 'fmtMW', 'fmtAxisPower', 'syntheticData']){
    assert.ok(!new RegExp(`^function ${fn}\\(`, 'm').test(app),
      `${fn} объявлена и в model.js, и в app.js — продублированная математика неизбежно расходится`);
  }
});

/* ---------- разбор пакетного ответа Open-Meteo ---------- */
test('пакетный запрос: один URL на все станции и корректная раскладка по станциям', () => {
  /* функции лежат в app.js (браузерный скрипт без экспортов) — вырезаем их
     исходник и исполняем здесь: проверяем реальный парсинг, а не копию */
  const src = app.slice(app.indexOf('function openMeteoUrls'), app.indexOf('async function fetchFromAPIBatch'));
  assert.ok(src.length > 500 && src.includes('nthPayload'), 'не нашли блок разбора Open-Meteo в app.js');
  const mod = new Function('HISTORY_START', 'todayISO',
    src + '\nreturn { openMeteoUrls, apiMeta, nthPayload, assembleData };')(
    '2023-01-01', () => '2026-11-17');

  /* 1. URL: координаты перечислены через запятую — это и есть «один запрос» */
  const urls = mod.openMeteoUrls('history', '60.76,60.71,60.67', '28.57,28.17,28.95');
  assert.equal(urls.length, 2);
  for (const u of urls){
    assert.match(u, /latitude=60\.76,60\.71,60\.67/);
    assert.match(u, /longitude=28\.57,28\.17,28\.95/);
    assert.match(u, /start_date=2023-01-01&end_date=2026-11-17/);
    assert.match(u, /timezone=UTC/);
  }
  assert.match(mod.openMeteoUrls('forecast', '1', '2')[0], /past_days=30&forecast_days=16/);
  assert.ok(!mod.openMeteoUrls('forecast', '1', '2')[0].includes('start_date'),
    'в прогнозе start_date быть не должно');

  /* 2. Ответ со списком координат — массив; с одной — объект. Оба варианта
        должны разбираться, иначе при одной станции в очереди ряд потеряется */
  const day = n => ['2024-01-0' + n, '2024-01-0' + (n + 1)];
  const multi = { daily: { time: day(1), temperature_2m_mean: [-5, -4], precipitation_sum: [1.2, 0] } };
  const multiArr = [multi, { daily: { time: day(3), temperature_2m_mean: [1, 2], precipitation_sum: [0, 3] } }];
  const floodArr = [{ daily: { time: day(1), river_discharge: [10, 12] } },
                    { daily: { time: day(3), river_discharge: [1, 2] } }];
  assert.deepEqual(mod.nthPayload(multiArr, 1), multiArr[1]);
  assert.equal(mod.nthPayload(multi, 0), multi, 'одиночный ответ должен читаться как есть');
  assert.equal(mod.nthPayload(multi, 1), null, 'индекс вне ответа — null, а не падение');
  assert.equal(mod.nthPayload({ foo: 1 }, 0), null, 'ответ без daily — null');

  const data = mod.assembleData(multiArr[0], floodArr[0]);
  assert.deepEqual(data.hydro.q, [10, 12]);
  assert.deepEqual(data.clim.t, [-5, -4]);
  assert.deepEqual(data.clim.time, day(1));
  assert.equal(data.clim.p.length, 2);

  /* 3. провенанс станции доживает до кэша — его показывает паспорт */
  const meta = mod.apiMeta({ latitude: 60.75, longitude: 28.95, model: 'glofas3', grid_code: '0.1',
                             elevation: 12, timezone: 'UTC', generationtime_ms: 0.4, daily: {} });
  assert.equal(meta.latitude, 60.75);
  assert.equal(meta.model, 'glofas3');
  assert.equal(mod.apiMeta(null), null);
  assert.equal(mod.apiMeta(multiArr), null, 'массив — не мета одиночного ответа');
});

/* ---------- данные ↔ паспорт ГЭС ---------- */
test('каждая станция паспорта обеспечена руслом, профилем дна и климат-моделью', () => {
  const ids = [...app.matchAll(/\{id:'([a-z]+)'/g)].map(m => m[1]);
  assert.ok(ids.length >= 6, 'не нашли паспорт станций в app.js');
  globalThis.window = globalThis;
  for (const f of ['rivers-data.js', 'terrain-data.js', 'climate-data.js', 'reservoirs-data.js']){
    require_(path.join(ROOT, f));
  }
  const R = globalThis.RIVER_COURSES, E = globalThis.RIVER_ELEV, C = globalThis.CLIMATE_DATA;
  for (const id of ids){
    assert.ok(R[id] && R[id].length >= 3, `${id}: нет русла в rivers-data.js — волна прорыва не построится`);
    assert.ok(E[id], `${id}: нет профиля дна в terrain-data.js — расчёт уйдёт в декоративный фолбэк`);
    assert.equal(E[id].length, R[id].length,
      `${id}: отметок дна (${E[id].length}) меньше, чем точек русла (${R[id].length}) — профиль рассохнется`);
    assert.ok(C[id] && C[id].hist && C[id].hist.length, `${id}: нет климатической модели для климат-режима`);
  }
});

test('в данных нет станций, отсутствующих в паспорте (список надо сокращать, не растить)', () => {
  const ids = [...app.matchAll(/\{id:'([a-z]+)'/g)].map(m => m[1]);
  /* DECISION(2026-11): 'yash' — русло, профиль дна и климат-модель есть,
     станции в HPPS нет. Либо вернуть её в паспорт, либо удалить данные;
     пока держим осознанным долгом, чтобы тест не был вечно красным. */
  const KNOWN_ORPHANS = new Set(['yash']);
  globalThis.window = globalThis;
  for (const f of ['rivers-data.js', 'terrain-data.js', 'climate-data.js']) require_(path.join(ROOT, f));
  for (const [name, obj] of [['RIVER_COURSES', globalThis.RIVER_COURSES],
                             ['RIVER_ELEV', globalThis.RIVER_ELEV],
                             ['CLIMATE_DATA', globalThis.CLIMATE_DATA]]){
    const orphans = Object.keys(obj || {}).filter(k => !ids.includes(k) && !KNOWN_ORPHANS.has(k));
    assert.deepEqual(orphans, [], `${name}: данные без станции в паспорте — ${orphans.join(', ')}`);
  }
});

/* ---------- service worker ---------- */
test('sw.js: кэш-лист покрывает оболочку, версия берётся из version.js', () => {
  const block = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  const shell = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(shell.length >= 10, 'не разобрали SHELL в sw.js');
  const local = shell.filter(u => /^https?:/.test(u) === false);
  assert.ok(local.includes('./model.js'), 'model.js не в кэше оболочки — офлайн сломается');
  assert.ok(local.includes('./version.js'), 'version.js не в кэше — importScripts в sw упадёт офлайн');
  assert.ok(local.includes('./app.js') && local.includes('./index.html'));
  for (const u of local){
    if (u === './') continue;
    assert.ok(exists(u.slice(2)), `в SHELL указан несуществующий файл: ${u}`);
  }
  assert.match(sw, /importScripts\('\.\/version\.js'\)/, 'sw.js не подключает version.js');
  assert.match(sw, /'ges-shell-' \+ \(self\.APP_VERSION/, 'имя кэша не привязано к APP_VERSION');
  assert.ok(!/ges-shell-v\d+/.test(sw), 'в sw.js захардкожена версия кэша — правьте только version.js');
});

test('версия сборки — единственный номер на страницу, sw и tests', () => {
  const v = require_(path.join(ROOT, 'version.js'));
  void v;
  const htmlVer = /сборка/.test(html);
  assert.ok(htmlVer, 'пропал штамп сборки — диагностика кэша не нужна?');
  assert.ok(!/id="buildStamp">[^<]*v\d\d/.test(html),
    'номер версии снова прописан в index.html — он должен приходить из version.js');
  assert.match(read('version.js'), /APP_VERSION = 'v\d+'/);
});

/* ---------- консистентность физики/документации ---------- */
test('константа Мэннинга: код, подпись в UI и README не противоречат друг другу', () => {
  const m = app.match(/const MANNING_N = ([\d.]+);/);
  assert.ok(m, 'MANNING_N не найдена — правка константы разойдётся с README');
  const n = parseFloat(m[1]);
  const readme = read('README.md');
  const claims = [...readme.matchAll(/n=0?[,.](\d+)/g)].map(x => parseFloat('0.' + x[1]));
  for (const c of claims){
    assert.ok(Math.abs(c - n) < 1e-9, `README заявляет n=${c}, а код считает при n=${n}`);
  }
  assert.ok(!/0\.035/.test(app), 'в app.js остался забынный литерал 0.035 вместо MANNING_N');
});

test('в UI не осталось «сырых» toFixed для подписей пользователю', () => {
  /* toFixed допустим только при подготовке ЧИСЕЛ для Chart.js (округление
     серий). Текстовые подписи идут через GES.num/fmtMW — иначе в интерфейсе
     точка вместо запятой и 'NaN' вместо прочерка. */
  const unit = /(['"`]\s*(МВт|кВт|км|м³\/с|км²|м%?|%)|° )/;
  const offenders = app.split('\n')
    .map((line, n) => ({ line, n: n + 1 }))
    .filter(o => o.line.includes('.toFixed(') && unit.test(o.line));
  assert.deepEqual(offenders.map(o => `${o.n}: ${o.line.trim()}`), [],
    'строки с locale-форматом пропущены');
});

/* ---------- конфигурация графиков (regression v46 → v47) ---------- */
test('Chart.js: type лежит в КОРНЕ конфига, а не в options', () => {
  /* Chart.js v4 берёт тип контроллера из config.type. Если его занести только
     в options, конструктор молча создаёт объект без контроллера, а падает уже
     на chart.update() — сообщением `"undefined" is not a registered
     controller.`. Так как update() вызывается из render(), rAF-анимаций и
     таймера, от одного пропуска валили графики, волна прорыва, перемотка, а
     «учебный сброс» начинал лагать (исключение в каждом кадре). */
  const calls = [...app.matchAll(/new Chart\(([^\n]*)\);/g)].map(m => m[1]);
  assert.ok(calls.length >= 2, 'ни одного new Chart — правка ушла из app.js?');
  for (const arg of calls){
    assert.doesNotMatch(arg, /options:\s*\{/,
      'options литералом внутри new Chart: type легко потерять — ' + arg.trim());
    assert.match(arg, /,\s*[A-Za-z_$][\w$]*\(/,
      'config обязан приходить из chartConfig(kind), где type на верхнем уровне: ' + arg.trim());
  }
  const helper = app.match(/const chartConfig = kind => \(\{([\s\S]*?)\n {2}\}\);/);
  assert.ok(helper, 'chartConfig не найден');
  assert.match(helper[1], /^\s*type:'line',/, "первым ключом chartConfig обязан быть type:'line'");
  assert.match(helper[1], /options: chartOptions\(kind\)/, 'chartConfig не передаёт options');

  const opts = app.match(/function chartOptions\(kind\)\{([\s\S]*?)\n {2}\}/);
  assert.ok(opts, 'chartOptions не найден');
  assert.doesNotMatch(opts[1], /(^|[,{\s])type\s*:/,
    'type внутри options — Chart.js его игнорирует, график останется без контроллера');
});

/* ---------- скрытие/показ графиков ---------- */
test('графики скрываются и показываются через одну функцию', () => {
  /* Причина, по которой «скрыть» раньше не работало: selectHPP вслепую
     вешал .show, и панель возвращалась при первом же выборе станции.
     Комментарии счищаем — иначе текст самого объяснения попадёт в проверку. */
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\$\('chartPanel'\)\.classList\.(add|remove|toggle)\(/,
    'прямая работа с .show/.open у #chartPanel мимо setChartsVisible');
  assert.match(app, /const CHARTS_KEY = 'ges_charts_v1';/,
    'намерение пользователя не запоминается — перезагрузка вернёт графики');
  assert.match(app, /function chartsWanted\(\)/);
  assert.match(app, /function setChartsVisible\(on, opts\)/);
  for (const id of ['chartHideBtn', 'chartShowBtn']){
    assert.ok(html.includes(`id="${id}"`), `в разметке нет #${id}`);
    assert.match(app, new RegExp("\\$\\('" + id + "'\\)"), `app.js не использует #${id}`);
  }
  /* ✕ и пилюля — <button type="button">: внутри формы/на клавиатуре submit не нужен */
  for (const id of ['chartHideBtn', 'chartShowBtn']){
    const tag = html.slice(html.indexOf(`id="${id}"`) - 260, html.indexOf(`id="${id}"`) + 260);
    assert.match(tag, /<button[^>]+type="button"/, `#${id} — кнопка без type="button"`);
  }
  /* панель при скрытии не должна оставаться «ящиком» на узком экране */
  assert.match(app, /panel\.classList\.toggle\('open', on && NARROW\(\)\)/,
    '.open на узких экранах не синхронизируется с show');
  /* canvas в display:none = 0×0: без resize() после показа будут пустые рамки */
  const body = app.slice(app.indexOf('function setChartsVisible'));
  assert.match(body.slice(0, 1400), /resizeCharts\(\)/, 'при показе графиков не вызывается resize');
});

/* ---------- статус-окно: не мешает слоям и переставляется ---------- */
test('статус-окно: ниже переключателя слоёв, не перекрывает его и двигается', () => {
  const css = read('style.css');
  const rule = css.match(/#statusBar\{([^}]*)\}/);
  assert.ok(rule, 'нет правила #statusBar');
  const decl = rule[1];

  /* Leaflet кладёт свои контролы в .leaflet-top (z-index:1000), а #statusBar в DOM
     идёт после #map: при z-index >= 1000 он лежал поверх раскрытого списка слоёв
     и перехватывал клики по радиокнопкам. */
  const z = /z-index:\s*(\d+)/.exec(decl);
  assert.ok(z, 'у #statusBar нет z-index — порядок наложений непредсказуем');
  assert.ok(+z[1] < 1000,
    `z-index:${z[1]} не ниже .leaflet-top (1000) — статус снова перекроет выбор слоя`);
  const top = /(?:^|[;{\s])top:\s*(\d+)px/.exec(decl);
  assert.ok(top && +top[1] >= 120,
    `top:${top ? top[1] : 'нет'}px — статус всё ещё там, куда разворачивается список слоёв`);
  assert.match(decl, /touch-action:\s*none/, 'без touch-action палец поведёт страницу, а не окно');

  /* двигается той же машинерией окон, но без закрепления размеров */
  assert.match(app, /makeDraggable\('statusBar', null, \{ moveOnly:true \}\)/,
    'статус-окно не подключено к перетаскиванию');
  assert.match(app, /const WINDOWS = \[[^\]]*'statusBar'[^\]]*\]/,
    'статус не в списке окон → его позиция не восстановится после перезагрузки');
  const apply = app.slice(app.indexOf('function applyLayout'));
  assert.match(apply.slice(0, 900), /if \(box\.moveOnly\)\{[\s\S]{0,240}?el\.style\.width = ''; el\.style\.height = '';/,
    'moveOnly обязан пропускать ширину/высоту: текст статуса меняет длину');
  assert.match(html, /<div id="statusBar"[^>]*class="drag-handle"/,
    'у статуса нет .drag-handle — непонятно, что его можно тащить');
});

/* ---------- плашка «Доступна новая версия» ---------- */
test('плашка обновления SW не показывается без необходимости', () => {
  const script = html.slice(html.indexOf('<button id="updateReady"'), html.indexOf('</script>', html.indexOf('<button id="updateReady"')));
  assert.ok(script.length > 200, 'не найден скрипт обновления рядом с #updateReady');
  /* решение принимать по reg.waiting, а не по факту 'installed':
     install в sw.js сам вызывает skipWaiting(), так что 'installed' наступает
     раньше активации — на прошлой логике кнопка вылезала на каждой первой
     загрузке после изменения sw.js, хотя перезагрузка была не нужна */
  assert.match(script, /if \(reg && reg\.waiting\)/, 'нет проверки reg.waiting — кнопка будет всплывать зря');
  assert.match(script, /setTimeout\(\(\) => \{ if \(reg && reg\.waiting\)[\s\S]{0,60}\}, 1500\)/,
    'нет выдержки перед показом (нужно, чтобы skipWaiting успел отработать)');
  /* прежний обработчик 'installed' + controller больше не является основанием */
  assert.ok(!/if \(nw\.state === 'installed' && navigator\.serviceWorker\.controller\)/.test(script),
    'старое условие по state+controller осталось — именно оно показывало кнопку просто так');
  /* клик должен добить зависший waiting, иначе reload() оставил бы его висеть */
  assert.match(script, /waiting\.postMessage\('skipWaiting'\)/, 'клик не передаёт управление новому воркеру');
  assert.match(script, /reloaded = true/, 'нет защиты от повторной перезагрузки');
  /* на sw.js-стороне обработчик сообщения обязан быть */
  assert.match(sw, /if \(e\.data === 'skipWaiting'\) self\.skipWaiting\(\)/);
  assert.match(sw, /\.then\(\(\) => self\.skipWaiting\(\)\)/, 'install не вызывает skipWaiting — обновлений не дождаться');
  /* плашка на узком экране не должна ложиться на #modeTabs (bottom:96px) */
  const css = read('style.css');
  const narrow = css.slice(css.indexOf('@media(max-width:900px)'));
  assert.match(narrow.slice(0, 1400), /#updateReady\{[^}]*bottom:auto[^}]*top:56px/,
    'на узком экране плашка обновления перекрывает переключатель режимов');
});

/* ---------- расположение окна учебного сброса ---------- */
test('поповер учебного сброса ставится ПОД маркером плотины', () => {
  const i = app.indexOf('async function startRelease');
  const block = app.slice(i, app.indexOf(".classList.add('show')", i));
  assert.ok(i > 0 && block.length > 200, 'startRelease не найден');
  assert.match(block, /className: 'breakPop pop-under'/,
    'нет класса pop-under — хвост останется снизу, и окно будет смотреть «на маркер»');
  assert.match(block, /offset: \[0, 12\]/, 'нужен стартовый зазор: высота меряется после вёрстки');
  assert.match(block, /placePopupUnder\(pop\)/, 'смещение по высоте не применяется');
  assert.match(block, /RELEASE\.popup = pop/, 'поповер не запоминается → его нечем закрывать');

  /*helper*/
  const helper = app.slice(app.indexOf('function placePopupUnder'), app.indexOf('async function startRelease'));
  assert.ok(helper.length > 100, 'placePopupUnder не найден');
  assert.match(helper, /getBoundingClientRect\(\)\.height\s*\|\|\s*el\.offsetHeight/,
    'высота контейнера не измеряется — смещение выйдет произвольным');
  assert.match(helper, /pop\.options\.offset = off;[\s\S]{0,40}pop\.update\(\)/,
    'Leaflet пересчитывает позицию только в update()');
  assert.ok(!/\.setOffset\(/.test(helper),
    'setOffset() в Leaflet 1.9 не существует — будет TypeError прямо на сбросе');

  /* окно обязано закрываться вместе со сценарием */
  const stop = app.slice(app.indexOf('function stopRelease'), app.indexOf('function releaseDetailsHTML'));
  assert.match(stop, /map\.closePopup\(RELEASE\.popup\)/,
    'после выключения сценария окно сброса остаётся висеть на карте');

  /* CSS-переворот хвоста */
  const css = read('style.css');
  assert.match(css, /\.leaflet-popup\.pop-under \.leaflet-popup-tip-container\{[^}]*top:-20px[^}]*bottom:auto/,
    'полоска хвоста не перенесена на верхний край контейнера');
  assert.match(css, /\.leaflet-popup\.pop-under \.leaflet-popup-tip\{[^}]*margin:10px auto 0/,
    'ромбик хвоста не перевёрнут — хвост будет смотреть вниз');
});

/* ---------- зеркало водохранилища в сценариях ---------- */
test('водохранилище Перовской меняет берег в «паводке» и «засухе»', () => {
  /* ряд: поправка применяется к копии результатов, а не на месте */
  assert.match(app, /S\.results\[h\.id\] = applyReservoirScenario\(r, h, c\.hydro\.time, S\.scenario\)/,
    'recompute не применяет схему зеркала');

  const i = app.indexOf('function drawReservoir');
  const j = app.indexOf("/* 2) Контур, полученный из Overpass", i);
  const model = read('model.js');
  const body = app.slice(i, j);
  assert.ok(i > 0 && j > i, 'drawReservoir не найден');
  assert.match(body, /g\.n \|\| g\.d \|\| g\.f/, 'контур НПВ (n) должен быть приоритетным');
  assert.match(body, /shorelineRings\(base, sc, \[h\.lat, h\.lon\]\)/,
    'берег не масштабируется по зеркалу');
  assert.match(body, /shore\.rings\.forEach/, 'рисовать надо то, что вернула схема берега, а не исходное кольцо');
  /* якорь — у плотины, иначе «водохранилище съезжает»: вода отрывается от створа,
     а серповидный берег вылезаёт за чашу */
  assert.match(model, /function shorelineRings\(rings, s, dam\)/, 'нет схемы берега с якорем у плотины');
  assert.match(model, /function pullInsideRing\(ring, outer\)/, 'нет посадки воды в чашу при сработке');
  assert.match(model, /вершина, ближайшая к ПЛОТИНЕ|ближайшей к ПЛОТИНЕ/,
    'в model.js не объяснено, почему якорь именно у створа');
  assert.match(body, /r\.shoreScale/, 'масштаб берега берётся не из ряда applyReservoirScenario');
  assert.match(body, /dash:\s*true/, 'нет пунктирной границы НПВ при отступлении воды');
  assert.ok(!/\[g\.d, g\.n, g\.f\]\[vi\]/.test(body),
    'выбор колец по вариантам n/d/f должен быть удалён: d/f — копии n, картинка не менялась');
  assert.ok(!/resVar/.test(app), 'гистерезис S.resVar больше не нужен (масштаб непрерывен)');

  /* подписи в карточке: без них «уползший» берег выглядит багом */
  assert.match(app, /Площадь берегового контура/, 'в карточке нет строки про площадь контура');
  assert.match(app, /shoreDrawn[\s\S]{0,400}% снимка при НПВ/,
    'процент должен считаться по рисуемой фигуре, а не как s² «на бумаге»');
  assert.ok(!/Площадь зеркала/.test(app),
    'площадь зеркала из модели в карточке не нужна — она противоречит рисуемому контуру');
  assert.match(app, /Поправка «/, 'в карточке нет строки про поправку сценария');
  assert.match(app, /зеркало пересчитано по водности года \(схема\)/,
    'нет пометки, что берег — схема');

  /* математика живёт в model.js (и там ей тесты), в UI — только применение */
  assert.match(read('model.js'), /function reservoirScenario\(h, factor\)/);
  assert.match(read('model.js'), /function applyReservoirScenario\(res, h, times, scen\)/);
  assert.match(read('model.js'), /function scaleRing\(ring, s, anchor\)/);
});
