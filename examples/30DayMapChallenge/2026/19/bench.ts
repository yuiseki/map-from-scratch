import { emit, readBack } from '../../../../harness/page/bench.ts';
import type { SmellRenderer } from './renderer.ts';

function pixel(renderer: SmellRenderer, point: { x: number; y: number }, size = 5): number[] {
  const ratio = renderer.canvas.width / renderer.canvas.clientWidth;
  return [...readBack(renderer.canvas.getContext('2d')!, Math.floor((point.x - size / 2) * ratio),
    Math.floor((point.y - size / 2) * ratio), size, size).data];
}

function averageRgb(data: number[]): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++; }
  return [r / n, g / n, b / n];
}

export async function run(renderer: SmellRenderer) {
  const { data } = renderer;
  const observation = data.observation;
  const source = data.sources[0]!;
  const body = document.body.innerText;
  const stationLink = [...document.querySelectorAll('a')].some((a) => a.href === observation.sourceUrl);
  const jmaStationPoint = renderer.screenPoint([observation.stationLon, observation.stationLat]);
  const sourcePixel = averageRgb(pixel(renderer, renderer.sourceScreen, 7));
  const plumePixel = averageRgb(pixel(renderer, renderer.getPlumePoint(3_500), 7));
  const upwind = renderer.getPlumePoint(0);
  const fromVector = Math.PI * observation.fromDegrees / 180;
  const upwindPoint = renderer.screenPoint([
    source.lon + Math.sin(fromVector) * 900 / (111_320 * Math.cos(source.lat * Math.PI / 180)),
    source.lat + Math.cos(fromVector) * 900 / 111_320,
  ]);
  const upwindPixel = averageRgb(pixel(renderer, upwindPoint, 7));
  const stationPixel = pixel(renderer, jmaStationPoint, 9);
  const stationHasBlueMark = stationPixel.some((_, index) => index % 4 === 0
    && stationPixel[index]! < 80 && stationPixel[index + 2]! > 70);

  emit({ metric: 'candidate_facilities', value: data.sources.length });
  emit({ metric: 'wind_observation_count', value: 1 });
  emit({ metric: 'plume_length_m', value: data.plume.lengthM });
  emit({ metric: 'roads', value: data.roads.length });
  emit({ metric: 'road_vertices', value: data.roads.reduce((sum, line) => sum + line.length, 0) });
  emit({ metric: 'waterways', value: data.waterways.length });
  emit({ metric: 'waterway_vertices', value: data.waterways.reduce((sum, line) => sum + line.length, 0) });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });

  emit({ check: 'facility-and-observation-provenance', pass: source.id === 'way/23690250'
    && source.name === '芝浦水再生センター' && observation.station === '東京'
    && observation.observedAt === '2026-11-04T18:00:00+09:00' && observation.fromLabel === '北北西'
    && observation.speedMps === 1.9 && stationLink,
    detail: `${source.id} ${source.name}; JMA Tokyo ${observation.observedAt}, from ${observation.fromLabel}, ${observation.speedMps} m/s` });
  emit({ check: 'measured-site-and-candidate-not-conflated', pass: Math.hypot(
    (observation.stationLon - source.lon) * 111_320 * Math.cos(source.lat * Math.PI / 180),
    (observation.stationLat - source.lat) * 111_320) > 5_000 && stationHasBlueMark,
    detail: `JMA station and wastewater candidate are distinct points; station-to-site distance ≈ ${Math.round(Math.hypot(
      (observation.stationLon - source.lon) * 111_320 * Math.cos(source.lat * Math.PI / 180),
      (observation.stationLat - source.lat) * 111_320))} m` });
  emit({ check: 'downwind-fan-is-warm-and-upwind-is-not', pass: plumePixel[0] > plumePixel[1] + 5
    && plumePixel[1] > plumePixel[2] + 5 && upwindPixel[0] <= upwindPixel[1] + 5,
    detail: `southeast fan RGB=${plumePixel.map(Math.round)}; upwind RGB=${upwindPixel.map(Math.round)}` });
  emit({ check: 'facility-outline-reaches-canvas', pass: sourcePixel[0] > sourcePixel[2] + 20,
    detail: `facility center RGB=${sourcePixel.map(Math.round)}` });
  emit({ check: 'model-limits-and-credit-visible', pass: body.includes('臭気の観測図ではありません')
    && body.includes('排出量') && body.includes('濃度') && body.includes('曝露')
    && body.includes('東京都下水道局') && body.includes('OpenStreetMap contributors')
    && body.includes('気象庁 東京') && body.includes('250 m + 距離の12%') && body.includes('風向一定')
    && body.includes('約6.2 km離れています'),
    detail: 'Page text distinguishes the qualitative illustration from measured odor, records fan assumptions and station separation, and identifies source institutions.' });

  const before = renderer.getSourcePoint();
  renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: renderer.canvas.clientWidth / 2, clientY: renderer.canvas.clientHeight / 2, bubbles: true, pointerId: 7 }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: renderer.canvas.clientWidth / 2 + 45, clientY: renderer.canvas.clientHeight / 2 + 24, bubbles: true, pointerId: 7 }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: renderer.canvas.clientWidth / 2 + 45, clientY: renderer.canvas.clientHeight / 2 + 24, bubbles: true, pointerId: 7 }));
  const after = renderer.getSourcePoint();
  const dragPass = Math.abs(after.x - before.x - 45) < 1 && Math.abs(after.y - before.y - 24) < 1;
  emit({ check: 'pointer-drag-pans-the-map', pass: dragPass, detail: `source moved ${Math.round(after.x - before.x)} px, ${Math.round(after.y - before.y)} px` });
  renderer.resetView();
  const zoomBefore = renderer.zoomLevel;
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const zoomPass = renderer.zoomLevel > zoomBefore;
  emit({ check: 'zoom-controls-change-map-scale', pass: zoomPass, detail: `zoom ${zoomBefore.toFixed(2)} → ${renderer.zoomLevel.toFixed(2)}` });
  renderer.resetView();

  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-requests', pass: external.length === 0, detail: `off-origin requests: ${external.length}` });
  const frameTimes: number[] = [], drawTimes: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 48; i++) {
    const frameStart = performance.now();
    renderer.draw();
    drawTimes.push(performance.now() - frameStart);
    await new Promise(requestAnimationFrame);
    frameTimes.push(performance.now() - frameStart);
    renderer.setZoom(renderer.zoomLevel * (i % 2 ? 1 / 1.002 : 1.002));
  }
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ info: { renderer: 'Dedicated Canvas 2D renderer', features: `${data.roads.length} road lines / ${data.waterways.length} waterways`, source: source.id, wind: `${observation.fromLabel} ${observation.speedMps} m/s`, plume: 'illustrative fan, 5 km; no odor or concentration model' } });
  emit({ done: true });
  void upwind;
}
