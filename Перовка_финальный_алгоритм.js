// Самостоятельный расчёт; не использует внешние библиотеки.
// Все времена в секундах, расстояния в метрах, расходы в м3/с.
const cfg = {
  area_m2: 15510, mean_drawdown_m: 0.10, // снижение УСЛОВНО
  background_m3s: 1.79, duration_s: 3600, peak_time_s: 1200,
  dt_s: 30, speed_parameter_ms: 1, horizon_s: 43200
};
// [накопленное расстояние, широта, долгота]
const points = [
  [0,60.679924,28.950886], [503,60.682763,28.954423],
  [1000,60.686019,28.955504], [1500,60.689338,28.951666],
  [2000,60.692894,28.948601], [2500,60.696733,28.946009],
  [3000,60.699537,28.939458]
];
function calculate(p, pts) {
  if (!Object.values(p).every(Number.isFinite)) throw Error('Не число');
  if (!(p.area_m2>0 && p.mean_drawdown_m>=0 && p.background_m3s>=0 &&
      p.peak_time_s>0 && p.duration_s>p.peak_time_s && p.dt_s>0 &&
      p.speed_parameter_ms>0 && p.horizon_s>=p.duration_s))
    throw Error('Недопустимые параметры');
  if (Math.abs(p.horizon_s/p.dt_s-Math.round(p.horizon_s/p.dt_s))>1e-9)
    throw Error('Горизонт должен быть кратен шагу');
  const volume = p.area_m2*p.mean_drawdown_m;
  const peak = 2*volume/p.duration_s;
  const tau = pts.slice(1).map((v,j)=>{
    const length=v[0]-pts[j][0];
    if (!(length>0)) throw Error('Расстояния должны возрастать');
    return length/p.speed_parameter_ms;
  });
  const storage=tau.map(()=>0), rows=[];
  let volumeIn=0, volumeOut=0;
  const source=t=>t<=p.peak_time_s ? peak*t/p.peak_time_s :
    (t<=p.duration_s ? peak*(p.duration_s-t)/(p.duration_s-p.peak_time_s) : 0);
  const steps=Math.round(p.horizon_s/p.dt_s);
  for(let n=0;n<=steps;n++) {
    const t=n*p.dt_s, inlet=source(t);
    let current=inlet;
    if(n>0) volumeIn+=inlet*p.dt_s;
    for(let j=0;j<tau.length;j++) {
      if(n>0) {
        storage[j]=(storage[j]+current*p.dt_s)/(1+p.dt_s/tau[j]);
        current=storage[j]/tau[j];
      } else current=0;
      rows.push({scenario_id:'area15510_drawdown010',reach_id:j+1,
        chainage_m:pts[j+1][0],latitude:pts[j+1][1],longitude:pts[j+1][2],
        time_s:t,extra_discharge_m3s:current,
        total_discharge_m3s:p.background_m3s+current});
    }
    if(n>0) volumeOut+=current*p.dt_s;
  }
  const remaining=storage.reduce((a,b)=>a+b,0);
  const residual=volumeIn-volumeOut-remaining;
  if(Math.abs(residual)>1e-8*Math.max(1,volumeIn)) throw Error('Баланс');
  return {parameters:p,rows,balance:{volumeIn,volumeOut,remaining,residual},
    source_volume_m3:volume,source_discretization_error_m3:volumeIn-volume};
}
const result=calculate(cfg,points);
// JSON для API/скачивания; результат не содержит зон затопления.
const json=JSON.stringify(result);
// Пример GeoJSON ТОЧЕК одного момента, не Polygon:
const tView=1800;
const geojson={type:'FeatureCollection',features:result.rows
  .filter(r=>r.time_s===tView).map(r=>({type:'Feature',
    geometry:{type:'Point',coordinates:[r.longitude,r.latitude]},properties:r}))};
// После изменения параметров задайте отдельный scenario_id для новой версии.
