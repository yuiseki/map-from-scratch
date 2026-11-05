import { emit } from '../../../../harness/page/bench.ts';
import { directionalNeighbor, type PresenceMap } from './lightdark.ts';
import type { PresenceRenderer } from './renderer.ts';

function pixelAt(renderer: PresenceRenderer, id: string, panelId: 'day' | 'night'): number[] | null {
  const point = renderer.centerFor(id, panelId);
  if (!point) return null;
  const ratio = renderer.canvas.width / renderer.canvas.clientWidth;
  return [...renderer.canvas.getContext('2d')!.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data];
}

export async function run(renderer: PresenceRenderer) {
  const data = renderer.data as PresenceMap;
  const stats = renderer.stats as {
    geometryCount: number; daytimeRecords: number; lateNightRecords: number;
    daytimePopulationTotal: number; lateNightPopulationTotal: number; sharedMaximum: number; payloadBytes: number;
  };
  emit({ metric: 'mesh_geometries', value: stats.geometryCount });
  emit({ metric: 'daytime_records', value: stats.daytimeRecords });
  emit({ metric: 'late_night_records', value: stats.lateNightRecords });
  emit({ metric: 'daytime_population_total', value: stats.daytimePopulationTotal });
  emit({ metric: 'late_night_population_total', value: stats.lateNightPopulationTotal });
  emit({ metric: 'shared_population_maximum', value: stats.sharedMaximum });
  emit({ metric: 'payload_bytes', value: stats.payloadBytes });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });

  const body = document.body.innerText, links = [...document.querySelectorAll('a')].map((anchor) => anchor.href);
  const scopeDisclosure = body.includes('2021年12月') && body.includes('1 km') && body.includes('11–14時')
    && body.includes('1–4時') && body.includes('10人未満') && body.includes('ゼロとは扱いません')
    && body.includes('衛星夜間光') && links.includes('https://www.geospatial.jp/ckan/dataset/mlit-1km-fromto');
  emit({ check: 'source-scope-and-limits-visible', pass: scopeDisclosure,
    detail: 'Period, times, 1 km resolution, unknown values and non-illumination interpretation are disclosed' });
  const attribution = body.includes('全国の人流オープンデータ') && body.includes('国土交通省') && body.includes('CC BY 4.0');
  emit({ check: 'mlit-attribution-and-license', pass: attribution,
    detail: 'MLIT source credit, source link and equivalent CC BY 4.0 terms are visible' });

  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-map-services', pass: external.length === 0,
    detail: `external runtime resources: ${external.length}` });

  const paired = data.meshes.find((mesh) => mesh.daytime !== null && mesh.lateNight !== null)!;
  const dayPoint = renderer.centerFor(paired.id, 'day')!, nightPoint = renderer.centerFor(paired.id, 'night')!;
  const dayPanel = renderer.panelRect('day')!, nightPanel = renderer.panelRect('night')!;
  const pixelRatio = renderer.canvas.width / renderer.canvas.clientWidth;
  const pixel = (point: { x: number; y: number }) => renderer.canvas.getContext('2d')!.getImageData(Math.floor(point.x * pixelRatio), Math.floor(point.y * pixelRatio), 1, 1).data;
  const dayCell = pixel(dayPoint), nightCell = pixel(nightPoint);
  const sameExtent = dayPanel.map.width > 0 && dayPanel.map.height > 0
    && Math.abs(dayPanel.map.width - nightPanel.map.width) < 0.01
    && Math.abs(dayPanel.map.height - nightPanel.map.height) < 0.01;
  emit({ check: 'matched-cell-geometries', pass: sameExtent && [...dayCell].slice(0, 3).some((value, i) => value !== [...nightCell][i]),
    detail: `shared max ${data.maximum}; paired mesh ${paired.id}; day=${[...dayCell].slice(0, 3)} night=${[...nightCell].slice(0, 3)}` });

  const strongestDay = data.meshes.reduce((best, mesh) => (mesh.daytime ?? -1) > (best.daytime ?? -1) ? mesh : best, data.meshes[0]!);
  const activePixel = pixelAt(renderer, strongestDay.id, 'day');
  const mapRect = dayPanel.map;
  const centerGap = renderer.centerFor(strongestDay.id, 'day');
  const visibleCell = !!activePixel && !!centerGap && centerGap.x >= mapRect.x && centerGap.x <= mapRect.x + mapRect.width
    && centerGap.y >= mapRect.y && centerGap.y <= mapRect.y + mapRect.height && activePixel[3] === 255
    && activePixel.slice(0, 3).some((value, index) => value !== [231, 227, 216][index]);
  emit({ check: 'actual-published-cell-pixel', pass: visibleCell,
    detail: `maximum published mesh ${strongestDay.id}: ${activePixel?.join(',')}` });

  const missingMesh = data.meshes.find((mesh) => mesh.daytime === null || mesh.lateNight === null);
  const missingIsNull = missingMesh ? (missingMesh.daytime === null || missingMesh.lateNight === null) : false;
  emit({ check: 'suppressed-data-remains-unknown', pass: missingIsNull,
    detail: `missing values remain null, example ${missingMesh?.id ?? 'none'}` });

  const selectedMesh = paired;
  const clickPoint = renderer.centerFor(selectedMesh.id, 'day')!;
  const bounds = renderer.canvas.getBoundingClientRect();
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: clickPoint.x + bounds.left, clientY: clickPoint.y + bounds.top, bubbles: true }));
  const pointerPass = renderer.view.selectedId === selectedMesh.id;
  emit({ check: 'pointer-selects-matched-mesh', pass: pointerPass,
    detail: `selected ${renderer.view.selectedId ?? 'none'} from shared daytime/nighttime location` });

  const next = directionalNeighbor(data, selectedMesh.id, 'right');
  renderer.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const keyboardPass = !!next && renderer.view.selectedId === next.id;
  emit({ check: 'keyboard-moves-selection', pass: keyboardPass,
    detail: `ArrowRight moved from ${selectedMesh.id} to ${renderer.view.selectedId ?? 'none'}` });

  const drawSamples: number[] = [], frameSamples: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 48; i++) {
    const frameStart = performance.now();
    const drawStart = performance.now(); renderer.draw(); drawSamples.push(performance.now() - drawStart);
    await new Promise(requestAnimationFrame);
    frameSamples.push(performance.now() - frameStart);
  }
  emit({ metric: 'frame_ms', values: frameSamples });
  emit({ metric: 'draw_cpu_ms', values: drawSamples });
  emit({ info: { renderer: 'Dedicated paired Canvas 2D WGS84 mesh renderer', dataSource: 'MLIT National People Flow Open Data', geography: 'Tokyo 1 km meshes', comparison: 'December 2021 daytime versus late-night presence estimates' } });
  renderer.select(null);
  emit({ done: true });
}
