import { emit, readBack } from '../../../../harness/page/bench.ts';
import { type FlowMap } from './renderer.ts';

export async function run(map: FlowMap) {
  const { stats } = map;
  emit({ metric: 'municipality_count', value: stats.municipalityCount });
  emit({ metric: 'prefecture_count', value: stats.prefectureCount });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'data_gzip_bytes', value: stats.totalGzipBytes });
  emit({ metric: 'active_frame_gzip_bytes', value: map.activeFrameBytes });
  emit({ info: { renderer: 'TypeScript + custom Canvas 2D renderer', source: 'MLIT monthly aggregated presence, 2019–2021', sourceVintage: stats.sourceVintage,
    municipalities: stats.municipalityCount, prefectures: stats.prefectureCount, dataGzipBytes: stats.totalGzipBytes, largestMonthlyChunkGzipBytes: stats.maxMonthGzipBytes,
    initialMonthGzipBytes: map.activeFrameBytes, interaction: 'month + weekday/holiday + daytime/late-night; select municipality' } });
  emit({ check: 'nationwide-geography', pass: stats.municipalityCount >= 1500 && stats.prefectureCount >= 40,
    detail: `${stats.municipalityCount} municipality points at approximate mesh-centre locations; ${stats.prefectureCount} prefecture outlines` });
  const taito = map.dataset.municipalities.findIndex((city) => city.code === '13106');
  await map.setFrame(2, 10); map.select(taito); map.state.dayType = 2; map.state.timezone = 0; map.draw();
  const bins = map.values(taito), populated = bins.some((v) => v > 0), city = map.dataset.municipalities[taito]!;
  const [x, y] = map.screenPoint(city), canvas = document.getElementById('map') as HTMLCanvasElement;
  const pixel = readBack(canvas.getContext('2d')!, Math.round(x * Math.min(2, devicePixelRatio)), Math.round(y * Math.min(2, devicePixelRatio))).data;
  emit({ check: 'real-destination-rendered', pass: populated && pixel[3] === 255 && (pixel[0]! > 80 || pixel[1]! > 100),
    detail: `Taito-ku November 2021 all-days daytime bins=${bins.join('/')}; marker pixel RGBA=${[...pixel].join(',')}` });
  const docs = document.body.innerText, links = [...document.querySelectorAll('a')].map((a) => a.href);
  emit({ check: 'aggregation-disclosure', pass: docs.includes('個人の移動経路は含みません') && docs.includes('10人未満は非公表')
    && docs.includes('メッシュ中心の平均位置') && docs.includes('加工して作成')
    && links.includes('https://www.geospatial.jp/ckan/dataset/mlit-1km-fromto'),
    detail: 'Broad origin bins, suppression, approximate positions, processing and source are disclosed' });
  emit({ check: 'interactive-controls', pass: ['month', 'day-type', 'timezone'].every((id) => !!document.getElementById(id))
    && map.hitTest(...map.screenPoint(city)) === taito,
    detail: 'Month, day type, time controls and municipality hit testing are available' });

  const original = { ...map.state }, frames: number[] = [], cpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.state.zoom = 1 + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * i / 79));
    map.state.panX = Math.sin(i / 13) * 24; map.state.panY = Math.cos(i / 17) * 15;
    const started = performance.now(); map.draw(); cpu.push(performance.now() - started);
    await new Promise(requestAnimationFrame); frames.push(performance.now() - started);
  }
  const monthLoads: number[] = [];
  for (let index = 0; index < 36; index++) {
    const started = performance.now(); await map.setFrame(Math.floor(index / 12), index % 12); monthLoads.push(performance.now() - started);
  }
  await map.setFrame(original.year, original.month); Object.assign(map.state, original); map.draw();
  emit({ metric: 'draw_cpu_ms', values: cpu }); emit({ metric: 'frame_ms', values: frames });
  emit({ metric: 'month_frame_ms', values: monthLoads }); emit({ done: true });
}
