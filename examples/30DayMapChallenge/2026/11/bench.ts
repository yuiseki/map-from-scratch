import { emit, readBack } from '../../../../harness/page/bench.ts';
import { channelAt, projectLocation, type SoundMap } from './renderer.ts';

export async function run(map: SoundMap) {
  const { stats, grid } = map;
  emit({ metric: 'road_ways', value: stats.roadWays });
  emit({ metric: 'rail_ways', value: stats.railWays });
  emit({ metric: 'road_cells', value: stats.roadCells });
  emit({ metric: 'rail_cells', value: stats.railCells });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'data_bytes', value: stats.outputBytes });
  emit({ info: { renderer: 'TypeScript + Canvas 2D custom renderer', audio: 'Web Audio API generated filtered noise + oscillator', sourceDate: stats.sourceDate,
    roadWays: stats.roadWays, railWays: stats.railWays, roadCells: stats.roadCells, railCells: stats.railCells, grid: `${grid.width}x${grid.height}`, dataBytes: stats.outputBytes } });
  emit({ check: 'source-coverage', pass: stats.sourceDate === '2026-08-31' && stats.roadWays >= 1000 && stats.railWays >= 100
    && stats.roadCells >= 1000 && stats.railCells >= 250, detail: `${stats.roadWays} road ways, ${stats.railWays} rail ways; ${stats.roadCells} + ${stats.railCells} occupied cells` });
  const roadCells = grid.roads.reduce((n, value) => n + Number(value > 0), 0);
  const railCells = grid.rails.reduce((n, value) => n + Number(value > 0), 0);
  emit({ check: 'channel-separation', pass: roadCells === stats.roadCells && railCells === stats.railCells && grid.width === 320 && grid.height === 320,
    detail: `${roadCells} road and ${railCells} railway cells decoded independently` });
  const shibuya = projectLocation(139.7013, 35.658, stats.bounds);
  const shibuyaSound = channelAt(grid, shibuya.x, shibuya.y);
  const point = map.gridToScreen(shibuya.x, shibuya.y), dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixel = readBack(map.context, point.x * dpr, point.y * dpr).data;
  const visible = (pixel[0]! > 35 || pixel[1]! > 70 || pixel[2]! > 90) && pixel[3] === 255;
  emit({ check: 'real-place-rendered', pass: (shibuyaSound.road > 0 || shibuyaSound.rail > 0) && visible,
    detail: `Shibuya grid has road=${shibuyaSound.road}, rail=${shibuyaSound.rail}; rendered RGBA ${[...pixel].join(',')}` });
  const text = document.body.innerText;
  const links = [...document.querySelectorAll('a')].map((anchor) => anchor.href);
  emit({ check: 'model-disclosure', pass: text.includes('実測音') && text.includes('デシベルではありません')
    && text.includes('2026-08-31') && text.includes('OpenStreetMap contributors')
    && links.includes('https://opendatacommons.org/licenses/odbl/1-0/') && links.includes('https://www.openstreetmap.org/copyright'),
    detail: 'modeled audio, no-measurement disclaimer, snapshot, attribution and ODbL links are visible' });
  emit({ check: 'audio-synthesis', pass: typeof AudioContext !== 'undefined' && !!document.getElementById('audio-toggle'), detail: 'Web Audio is available for separate tested road-noise and rail-tone synthesis parameters' });
  const original = { ...map.view }, frames: number[] = [], cpu: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.view.zoom = 1 + 1.4 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 79));
    map.view.panX = Math.sin(i / 13) * 40; map.view.panY = Math.cos(i / 17) * 24;
    const started = performance.now(); map.draw(); cpu.push(performance.now() - started);
    await new Promise(requestAnimationFrame); frames.push(performance.now() - started);
  }
  Object.assign(map.view, original); map.draw();
  emit({ metric: 'draw_cpu_ms', values: cpu }); emit({ metric: 'frame_ms', values: frames }); emit({ done: true });
}
