import { emit } from '../../../../harness/page/bench.ts';
import type { TasteRenderer } from './renderer.ts';

function coloredPixels(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let count = 0;
  for (let i = 0; i < data.length; i += 4 * 8) {
    if (data[i]! < 235 || data[i + 1]! < 230 || data[i + 2]! < 220) count++;
  }
  return count * 8;
}

export async function run(map: TasteRenderer): Promise<void> {
  const canvas = map.canvas;
  map.draw();
  const pixelCount = coloredPixels(canvas);
  const initialCount = map.visibleCount;
  const initialZoom = map.zoomLevel;
  emit({ metric: 'food_features', value: map.featureCount });
  emit({ metric: 'point_features', value: map.pointCount });
  emit({ metric: 'area_features', value: map.areaCount });
  emit({ metric: 'occupied_grid_cells', value: map.gridCellCount });
  emit({ metric: 'cuisine_tagged', value: map.cuisineTaggedCount });
  emit({ metric: 'cuisine_unspecified', value: map.cuisineUnspecifiedCount });
  emit({ metric: 'visible_grid_pixels', value: pixelCount });
  emit({ metric: 'first_frame_ms', value: map.firstFrameMs });
  emit({ check: 'frozen-food-feature-count-and-visible-map', pass: map.featureCount === 4905 && pixelCount > 5000,
    detail: `${map.featureCount} frozen food places; ${pixelCount} sampled non-paper pixels in the rendered view` });

  const cafe = document.querySelector<HTMLInputElement>('input[data-category="cafe"]')!;
  cafe.checked = false; cafe.dispatchEvent(new Event('change', { bubbles: true }));
  map.draw();
  const filteredCount = map.visibleCount;
  cafe.checked = true; cafe.dispatchEvent(new Event('change', { bubbles: true }));
  emit({ check: 'keyboard-category-filter-control', pass: filteredCount < initialCount && map.visibleCount === initialCount && cafe.tabIndex >= 0,
    detail: `native focusable checkbox toggles cafe group: ${initialCount} → ${filteredCount} → ${map.visibleCount}` });

  const target = map.screenPoint(map.inspectionFeatureId);
  const rect = canvas.getBoundingClientRect();
  if (target) {
    const x = rect.left + target.x, y = rect.top + target.y;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 71, clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, clientX: x, clientY: y, bubbles: true }));
  }
  await new Promise(requestAnimationFrame);
  const selection = document.getElementById('selection')!.innerText;
  emit({ check: 'feature-inspection-retains-osm-id-and-source-tags', pass: selection.includes(map.inspectionFeatureId)
    && (selection.includes('amenity') || selection.includes('shop')),
    detail: `${map.inspectionFeatureId}: ${selection.replaceAll('\n', ' · ')}` });

  const beforePan = map.screenPoint(map.inspectionFeatureId)!;
  const startX = rect.left + rect.width / 2, startY = rect.top + rect.height / 2;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 72, clientX: startX, clientY: startY, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 72, clientX: startX + 34, clientY: startY + 18, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 72, clientX: startX + 34, clientY: startY + 18, bubbles: true }));
  const afterPan = map.screenPoint(map.inspectionFeatureId)!;
  const panPass = Math.abs(afterPan.x - beforePan.x - 34) < 1 && Math.abs(afterPan.y - beforePan.y - 18) < 1;
  document.getElementById('reset')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const zoomChanged = map.zoomLevel > initialZoom;
  document.getElementById('zoom-out')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.getElementById('reset')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  emit({ check: 'pan-zoom-and-scale-bar', pass: panPass && zoomChanged && document.getElementById('scale-label')!.textContent!.length > 0,
    detail: `drag delta ${Math.round(afterPan.x - beforePan.x)},${Math.round(afterPan.y - beforePan.y)} px; zoom changed ${zoomChanged}; scale ${document.getElementById('scale-label')!.textContent}` });

  const body = document.body.innerText;
  emit({ check: 'attribution-odbl-and-interpretation-visible', pass: body.includes('© OpenStreetMap contributors')
    && body.includes('ODbL 1.0') && body.includes('share-alike') && body.includes('2026-08-31')
    && body.includes('味') && body.includes('品質'),
    detail: 'OSM attribution, snapshot, ODbL share-alike and visible limits are present in Japanese page copy' });
  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-requests', pass: external.length === 0, detail: `${external.length} cross-origin resources` });

  const frameTimes: number[] = [], drawTimes: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 48; i++) {
    const start = performance.now(); map.draw(); drawTimes.push(performance.now() - start);
    await new Promise(requestAnimationFrame); frameTimes.push(performance.now() - start);
  }
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ info: { renderer: 'dedicated Canvas 2D food-tag renderer', source: 'Tokyo OSM snapshot 2026-08-31', features: map.featureCount, groups: 4 } });
  emit({ done: true });
}
