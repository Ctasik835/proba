/* Автотесты модели (model.js). Запуск: npm test  →  node --test tests/
   Здесь только чистая математика: без DOM, сети и Leaflet. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GES = createRequire(import.meta.url)(path.join(ROOT, 'model.js'));

const HPP = {
  id: 'pero', name: 'Перовская', lat: 60.68, lon: 28.95,
  capacityMW: 0.15, head: 5.5, eff: .82, nmu: 17.5, umo: 12,
  areaNMU: 0.03, totalVolume: 0.00008, usefulVolume: 0.00002
};

/* ---------- календарь: ни дублей, ни пропусков, ни в какой зоне ---------- */
test('dayRange не зависит от часовой пояса и не теряет дни на DST', () => {
  const days = GES.dayRange('2023-01-01', '2024-12-31');
  assert.equal(days[0], '2023-01-01');
  assert.equal(days[days.length - 1], '2024-12-31');
  assert.equal(days.length, 365 + 366);
  for (let i = 1; i < days.length; i++){
    assert.equal(+new Date(days[i] + 'T00:00:00Z') - +new Date(days[i-1] + 'T00:00:00Z'),
      86400000, 'разрыв в ' + days[i]);
  }
});

test('syntheticData даёт ровный календарь в экзотических TZ (регрессия на DST)', () => {
  /* ровно этот баг и ловили: в Europe/Berlin цикл на setDate+toISOString
     выдавал 4 дубля и 4 пропуска за период с 2023 г. */
  const src = `
    const GES = require(${JSON.stringify(path.join(ROOT, 'model.js'))});
    const out = {};
    for (const mode of ['history','forecast','climate']){
      const d = GES.syntheticData(${JSON.stringify(HPP)}, mode, { now: Date.UTC(2026,10,25) });
      const t = d.hydro.time; let bad = 0;
      for (let i = 1; i < t.length; i++){
        if (+new Date(t[i]+'T00:00:00Z') - +new Date(t[i-1]+'T00:00:00Z') !== 86400000) bad++;
      }
      out[mode] = { n: t.length, bad, first: t[0], last: t[t.length-1] };
    }
    console.log(JSON.stringify(out));`;
  for (const TZ of ['UTC', 'Europe/Berlin', 'Pacific/Marquesas', 'Asia/Kathmandu', 'Pacific/Kiritimati']){
    const res = JSON.parse(execFileSync(process.execPath, ['-e', src], { env: { ...process.env, TZ } }).toString());
    for (const mode of Object.keys(res)){
      assert.equal(res[mode].bad, 0, `${TZ}/${mode}: смещённые даты в ряду`);
      assert.ok(res[mode].n > 10, `${TZ}/${mode}: пустой ряд`);
    }
  }
});

test('dayOfYear/daysInMonth считают по UTC-календарю', () => {
  assert.equal(GES.dayOfYear('2024-01-01'), 1);
  assert.equal(GES.dayOfYear('2024-12-31'), 366);        // високосный
  assert.equal(GES.dayOfYear('2023-12-31'), 365);
  assert.equal(GES.dayOfYear('2024-02-29T00:00'), 60);
  assert.equal(GES.daysInMonth(2024, 2), 29);
  assert.equal(GES.daysInMonth(2023, 2), 28);
  assert.equal(GES.daysInMonth(2024, 12), 31);
});

/* ---------- сводка рядов по дате, а не по номеру элемента ---------- */
test('alignIndex: месячный ряд не съезжает относительно суточного', () => {
  const monthly = ['2024-01-15','2024-02-15','2024-03-15'];
  const idx = GES.buildTimeIndex(monthly);
  assert.equal(GES.alignIndex(0, monthly.length, idx, '2024-01-15'), 0);
  assert.equal(GES.alignIndex(45, monthly.length, idx, '2024-02-15'), 1);
  assert.equal(GES.alignIndex(100, monthly.length, idx, '2024-03-15'), 2);
  /* даты нет — берём ближайший доступный, но никогда не выходим за ряд */
  const k = GES.alignIndex(999, monthly.length, idx, '2024-07-01');
  assert.ok(k >= 0 && k < monthly.length);
  assert.equal(GES.alignIndex(0, 0, idx, '2024-01-15'), -1, 'пустой ряд → -1');
});

/* ---------- форматирование ---------- */
test('числа форматируются по-русски, NaN показывается как «—»', () => {
  assert.equal(GES.num(0.15, 2), '0,15');
  /* разделитель тысяч зависит от сборки ICU (\u00a0 / \u202f / узкий пробел) —
     проверяем сам факт: запятая как десятичный разделитель и групповой разделитель между цифрами */
  assert.equal(GES.num(1234.5, 1).replace(/[\s\u00a0\u202f]/g, ''), '1234,5');
  assert.equal(GES.num(undefined, 2), '—');
  assert.equal(GES.num(NaN, 2), '—');
  assert.equal(GES.fmtMW(0.15), '150 кВт');
  assert.equal(GES.fmtMW(12.4), '12 МВт');
  assert.equal(GES.fmtMW(NaN), '0 МВт');
  assert.equal(GES.fmtDateRu('2024-05-03'), '03.05.2024');
  assert.equal(GES.fmtDateRu(null), '—');
});

/* ---------- сценарии: множитель от даты, а не от бегунка ---------- */
test('scenarioFactor: паводок — весенний горб, засуха — летняя межень, всё монотонно к дате', () => {
  /* пик паводка в мае, зимой — единица; важно: значение НЕ зависит от индекса бегунка */
  assert.ok(GES.scenarioFactor(HPP, '2024-05-08', 'flood') > 3, 'в пик половодья разбор должен быть большим');
  assert.equal(GES.scenarioFactor(HPP, '2024-01-15', 'flood'), GES.scenarioFactor(HPP, '2024-01-15', 'flood'));
  assert.ok(Math.abs(GES.scenarioFactor(HPP, '2023-01-15', 'flood') - 1) < 0.05, 'зимой паводок не должен множить ряд');
  assert.ok(GES.scenarioFactor(HPP, '2024-07-20', 'drought') <= 0.2, 'летом засуха режет приток');
  assert.ok(GES.scenarioFactor(HPP, '2024-01-20', 'drought') > 0.9, 'зимой засуха не трогает ряд');
  assert.equal(GES.scenarioFactor(HPP, '2024-07-20', 'normal'), 1);
  assert.equal(GES.scenarioFactor(HPP, '2024-07-20', 'dam_break'), 1);
});

/* ---------- модель ГЭС: инварианты ---------- */
test('simulate держит уровень в коридоре УМО..НПУ и мощность ≤ установленной', () => {
  const data = GES.syntheticData(HPP, 'history', { now: Date.UTC(2025, 5, 1) });
  for (const sc of ['normal', 'flood', 'drought']){
    const q = data.hydro.q.map((v, k) => v * GES.scenarioFactor(HPP, data.hydro.time[k], sc));
    const r = GES.simulate(HPP, { time: data.hydro.time, q }, data.clim);
    assert.equal(r.level.length, data.hydro.q.length);
    for (let i = 0; i < r.level.length; i++){
      assert.ok(Number.isFinite(r.level[i]) && Number.isFinite(r.power[i]) && Number.isFinite(r.lf[i]),
        `${sc}[${i}]: не-число в ряду`);
      assert.ok(r.level[i] >= HPP.umo - 1e-6 && r.level[i] <= HPP.nmu + 1e-6,
        `${sc}: уровень ${r.level[i]} вне коридора ${HPP.umo}..${HPP.nmu}`);
      assert.ok(r.power[i] >= 0 && r.power[i] <= HPP.capacityMW + 1e-9, `${sc}: мощность выше установленной`);
      assert.ok(r.spill[i] >= 0 && r.flow[i] >= 0);
    }
    assert.ok(r.kwh > 0, `${sc}: нулевая выработка за год`);
  }
});

test('simulate: плотина без генератора (capacityMW = 0) не даёт NaN в загрузке', () => {
  const dam = Object.assign({}, HPP, { capacityMW: 0, notHPP: true });
  const data = GES.syntheticData(dam, 'history', { now: Date.UTC(2025, 5, 1) });
  const r = GES.simulate(dam, data.hydro, data.clim);
  assert.ok(r.lf.every(v => Number.isFinite(v) && v === 0), 'lf должен быть 0, а не NaN');
  assert.ok(r.power.every(v => v === 0));
});

test('simulate: пустой/битый вход не роняет модель', () => {
  for (const bad of [undefined, null, { q: [] }, { q: [null, NaN, 5] }]){
    const r = GES.simulate(HPP, bad, { t: [], p: [] });
    assert.ok(Array.isArray(r.level), 'всегда возвращаем ряды');
    assert.ok(r.level.length === 0 || r.level.every(Number.isFinite));
  }
});

/* ---------- учебный сценарий сброса: паритет с эталоном пользователя ---------- */
test('releaseCalculate совпадает с «Перовка_финальный_алгоритм.js» и закрывает баланс', () => {
  const src = fs.readFileSync(path.join(ROOT, 'Перовка_финальный_алгоритм.js'), 'utf8');
  const ref = new Function('module', 'exports', src + '\nreturn calculate(cfg, points);')({}, {});

  const p = { area_m2: 15510, mean_drawdown_m: .10, background_m3s: 1.79, duration_s: 3600,
              peak_time_s: 1200, dt_s: 30, speed_parameter_ms: 1, horizon_s: 43200 };
  const pts = [[0,60.679924,28.950886],[503,60.682763,28.954423],[1000,60.686019,28.955504],
               [1500,60.689338,28.951666],[2000,60.692894,28.948601],[2500,60.696733,28.946009],
               [3000,60.699537,28.939458]];
  const mine = GES.releaseCalculate(p, pts);

  assert.equal(mine.volume, 1551);
  assert.ok(Math.abs(mine.peak - 2 * 1551 / 3600) < 1e-12);
  assert.equal(mine.tau.length, 6);
  assert.equal(mine.steps, 1440);

  let maxDiff = 0;
  for (const row of ref.rows){
    const n = Math.round(row.time_s / p.dt_s), j = row.reach_id - 1;
    maxDiff = Math.max(maxDiff, Math.abs(row.extra_discharge_m3s - mine.out[n * mine.tau.length + j]));
  }
  assert.ok(maxDiff < 1e-12, 'ряды_extra расходятся: ' + maxDiff);
  assert.ok(mine.balance.ok, 'водный баланс не замкнулся: ' + mine.balance.residual);
  assert.ok(Math.abs(mine.balance.residual) <= 1e-8 * Math.max(1, mine.balance.volumeIn));
});

test('releaseCalculate отвергает битовые параметры (как эталон), а не молчит', () => {
  const good = { area_m2: 15510, mean_drawdown_m: .10, background_m3s: 1.79, duration_s: 3600,
                 peak_time_s: 1200, dt_s: 30, speed_parameter_ms: 1, horizon_s: 43200 };
  const pts = [[0,0,0],[500,0,0],[1000,0,0]];
  assert.doesNotThrow(() => GES.releaseCalculate(good, pts));
  assert.throws(() => GES.releaseCalculate(Object.assign({}, good, { area_m2: 0 }), pts), /параметр/);
  assert.throws(() => GES.releaseCalculate(Object.assign({}, good, { duration_s: 1000 }), pts), /недопустим/);
  assert.throws(() => GES.releaseCalculate(Object.assign({}, good, { horizon_s: 43215 }), pts), /кратен/);
  assert.throws(() => GES.releaseCalculate(Object.assign({}, good, { dt_s: NaN }), pts), /не число/);
  assert.throws(() => GES.releaseCalculate(good, [[0,0,0],[400,0,0],[300,0,0]]), /возрастать/);
});

test('damBreakView не портит исходный ряд', () => {
  const data = GES.syntheticData(HPP, 'history', { now: Date.UTC(2025, 5, 1) });
  const r = GES.simulate(HPP, data.hydro, data.clim);
  const before = r.power.slice(0, 5);
  const broken = GES.damBreakView(r);
  assert.deepEqual(broken.power.slice(0, 5), [0, 0, 0, 0, 0]);
  assert.deepEqual(r.power.slice(0, 5), before, 'исходный ряд должен остаться нетронутым');
  assert.deepEqual(broken.spill, r.flow, 'сброс = весь расход');
});

test('movingAverage: окно, границы и пустой вход', () => {
  assert.deepEqual(GES.movingAverage([1, 2, 3, 4], 3), [1.5, 2, 3, 3.5]);
  assert.deepEqual(GES.movingAverage([1, 2, 3], 1), [1, 2, 3]);
  assert.deepEqual(GES.movingAverage(undefined, 5), []);
});
