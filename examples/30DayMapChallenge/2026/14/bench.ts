import { emit, readBack } from '../../../../harness/page/bench.ts';
import { groundScale } from './territory.ts';
import type { TerritoryMap } from './renderer.ts';

export async function run(map: TerritoryMap) {
  emit({ metric: 'building_count', value: map.dataset.features.length });
  emit({ metric: 'vertex_count', value: map.stats.vertexCount });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ metric: 'data_bytes', value: map.stats.outputBytes });
  emit({ info: { renderer: 'Custom TypeScript Canvas 2D with direct EPSG:3857 Path2D geometry', source: map.stats.source,
    buildings: map.dataset.features.length, rings: map.stats.ringCount, vertices: map.stats.vertexCount, dataBytes: map.stats.outputBytes,
    physicalScale: 'credit-card calibration plus local cos(latitude) ground correction' } });

  const docs = document.body.innerText, links = [...document.querySelectorAll('a')].map((a) => a.href);
  emit({ check: 'source-odbl-and-scope', pass: docs.includes('OpenStreetMap') && docs.includes('ODbL 1.0')
    && docs.includes('行政界ではありません') && docs.includes('測量成果ではありません')
    && links.includes('https://www.openstreetmap.org/copyright'), detail: 'ODbL, source snapshot, non-official bbox and survey caveat are visible' });
  emit({ check: 'physical-calibration-control', pass: docs.includes('85.60 mm') && !!document.getElementById('calibrate')
    && (document.getElementById('physical-mode') as HTMLButtonElement).disabled,
    detail: 'The physical mode starts disabled and explains card-width calibration' });

  const focus = map.stats.physicalFocus.epsg3857;
  const expected = map.dataset.features.findIndex((feature) => feature.id === BigInt(map.stats.physicalFocus.osmRelationId));
  const [fx, fy] = map.screenPoint(focus.x, focus.y);
  const hit = map.hitTest(fx, fy);
  const mapCanvas = document.getElementById('map') as HTMLCanvasElement;
  const pixel = readBack(mapCanvas.getContext('2d')!, Math.round(fx * mapCanvas.width / mapCanvas.clientWidth), Math.round(fy * mapCanvas.height / mapCanvas.clientHeight)).data;
  const painted = pixel[0] !== 209 || pixel[1] !== 201 || pixel[2] !== 183;
  emit({ check: 'real-building-and-geometry-hit', pass: expected >= 0 && hit === expected && painted,
    detail: `OSM relation/${map.stats.physicalFocus.osmRelationId} hit=${hit}; sample pixel=${[...pixel].join(',')}; ${map.stats.sourceBuildingRows} buildings / ${map.stats.vertexCount} vertices` });

  const initial = { ...map.view };
  const cpu: number[] = [], frames: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 80; i++) {
    map.view.zoom = 1 + 0.35 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * i / 79));
    map.view.centerX = initial.centerX + Math.sin(i / 9) * 80;
    map.view.centerY = initial.centerY + Math.cos(i / 11) * 55;
    const started = performance.now(); map.draw(); cpu.push(performance.now() - started);
    await new Promise(requestAnimationFrame); frames.push(performance.now() - started);
  }

  const cardWidth = document.getElementById('card-width') as HTMLInputElement;
  cardWidth.value = '320'; cardWidth.dispatchEvent(new Event('input', { bubbles: true }));
  (document.getElementById('calibrate') as HTMLButtonElement).click();
  (document.getElementById('physical-mode') as HTMLButtonElement).click();
  const measured = map.scalePxPerProjectedMeter;
  const expectedScale = groundScale(320 / 85.6, map.stats.physicalFocus.wgs84.lat);
  const buttonsReady = !(document.getElementById('physical-mode') as HTMLButtonElement).disabled;
  emit({ check: 'calibrated-ground-scale', pass: Math.abs(measured - expectedScale) < 1e-8 && buttonsReady,
    detail: `measured px/projected-m=${measured}; expected=${expectedScale}; lat=${map.stats.physicalFocus.wgs84.lat}` });

  (document.getElementById('overview-mode') as HTMLButtonElement).click();
  const overviewLabel = document.getElementById('scale-label')!.textContent;
  const overviewBarWidth = Number.parseFloat((document.getElementById('scale-bar') as HTMLDivElement).style.width);
  const projectedBarAccurate = overviewLabel === 'EPSG:3857 投影上 50 m'
    && Math.abs(overviewBarWidth - 50 * map.scalePxPerProjectedMeter) < 0.01;
  emit({ check: 'overview-projection-scale-bar', pass: projectedBarAccurate,
    detail: `label=${overviewLabel}; bar=${overviewBarWidth}px matches 50 projected metres` });
  (document.getElementById('physical-mode') as HTMLButtonElement).click();

  cardWidth.value = '319'; cardWidth.dispatchEvent(new Event('input', { bubbles: true }));
  const calibrationInvalidated = !map.state.calibrated && !map.state.physicalMode
    && (document.getElementById('physical-mode') as HTMLButtonElement).disabled
    && document.getElementById('scale-status')!.textContent!.includes('未校正');
  emit({ check: 'calibration-invalidated-on-change', pass: calibrationInvalidated,
    detail: 'Changing the calibration reference exits 1:1 and disables its control until reconfirmed' });
  cardWidth.value = '320'; cardWidth.dispatchEvent(new Event('input', { bubbles: true }));
  (document.getElementById('calibrate') as HTMLButtonElement).click();
  (document.getElementById('physical-mode') as HTMLButtonElement).click();

  const canvas = document.getElementById('map') as HTMLCanvasElement;
  canvas.focus();
  const centerBefore = map.view.centerX;
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const arrowMovedMap = map.view.centerX > centerBefore;
  (document.getElementById('physical-mode') as HTMLButtonElement).click(); canvas.focus();
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const keyboardSelected = map.state.selected === expected;
  const overviewCanvas = document.getElementById('overview') as HTMLCanvasElement;
  overviewCanvas.focus(); const overviewBefore = map.view.centerX;
  overviewCanvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const overviewMovedMap = map.view.centerX > overviewBefore;
  emit({ check: 'keyboard-map-interaction', pass: arrowMovedMap && keyboardSelected && overviewMovedMap,
    detail: `Map ArrowRight=${arrowMovedMap}; Enter selected OSM feature=${keyboardSelected}; overview ArrowRight moved detail center=${overviewMovedMap}` });

  const original = { ...initial };
  Object.assign(map.view, original); (document.getElementById('overview-mode') as HTMLButtonElement).click(); map.draw();
  emit({ metric: 'draw_cpu_ms', values: cpu }); emit({ metric: 'frame_ms', values: frames });
  emit({ done: true });
}
