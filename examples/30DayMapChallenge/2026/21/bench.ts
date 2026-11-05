import { emit, readBack } from '../../../../harness/page/bench.ts';
import type { Category, OSMFeature } from './osm.ts';
import type { OSMRenderer } from './renderer.ts';

const RGB: Record<Category, [number, number, number]> = {
  green: [117, 155, 111], water: [83, 160, 185], building: [240, 228, 211],
  road: [156, 107, 73], railway: [158, 71, 96], 'public-place': [186, 78, 51],
};
function countColor(renderer: OSMRenderer, rgb: [number, number, number], tolerance = 10): number {
  const pixels = readBack(renderer.context, 0, 0, renderer.canvas.width, renderer.canvas.height).data;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    if (Math.abs(pixels[i]! - rgb[0]) < tolerance && Math.abs(pixels[i + 1]! - rgb[1]) < tolerance
        && Math.abs(pixels[i + 2]! - rgb[2]) < tolerance && pixels[i + 3]! > 220) count++;
  }
  return count;
}
function vertices(feature: OSMFeature): number { return feature.geometry.parts.reduce((count, part) => count + part.length, 0); }
function waitFrame() { return new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
function sameCounts(actual: Record<string, number>, expected: Record<string, number>): boolean {
  return Object.keys(expected).length === Object.keys(actual).length && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

export async function run(renderer: OSMRenderer) {
  const { features } = renderer;
  const categories: Category[] = ['road', 'railway', 'building', 'water', 'green', 'public-place'];
  const stats = new Map<Category, number>();
  const vertexCounts = new Map<Category, number>();
  for (const feature of features) {
    stats.set(feature.category, (stats.get(feature.category) ?? 0) + 1);
    vertexCounts.set(feature.category, (vertexCounts.get(feature.category) ?? 0) + vertices(feature));
  }
  const sourceRows = Object.fromEntries(['planet_osm_point', 'planet_osm_line', 'planet_osm_polygon', 'planet_osm_roads']
    .map((table) => [table, features.filter((feature) => feature.table === table).length]));
  const expectedSources = { planet_osm_point: 4121, planet_osm_line: 27, planet_osm_polygon: 15257, planet_osm_roads: 543 };
  const expectedCategories = { road: 355, railway: 188, water: 44, building: 14958, green: 282, 'public-place': 4121 };
  const totalVertices = features.reduce((sum, feature) => sum + vertices(feature), 0);
  emit({ metric: 'rendered_features', value: features.length });
  emit({ metric: 'rendered_vertices', value: totalVertices });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });
  for (const category of categories) emit({ metric: `${category.replace('-', '_')}_features`, value: stats.get(category) ?? 0 });

  renderer.draw();
  const categoryPixels = new Map<Category, number>();
  for (const category of categories) categoryPixels.set(category, countColor(renderer, RGB[category]));
  const yoyogi = features.find((feature) => feature.id === -19_862_716n && feature.tags.name === '代々木公園');
  emit({ check: 'source-rows-and-original-ids', pass: features.length === 19948 && totalVertices === 105147
    && features.every((feature) => typeof feature.id === 'bigint' && feature.tags && feature.table.startsWith('planet_osm_'))
    && sameCounts(sourceRows, expectedSources)
    && sameCounts(Object.fromEntries(categories.map((category) => [category, stats.get(category) ?? 0])), expectedCategories)
    && Boolean(yoyogi && yoyogi.table === 'planet_osm_polygon' && yoyogi.category === 'green' && yoyogi.geometry.polygonRingEnds?.length),
    detail: `${features.length} rows / ${totalVertices} vertices; source rows ${JSON.stringify(sourceRows)}; categories ${JSON.stringify(Object.fromEntries(stats))}; known relation/19862716 ${yoyogi?.tags.name ?? 'missing'}` });
  emit({ check: 'six-osm-category-pixels', pass: categories.every((category) => (categoryPixels.get(category) ?? 0) > 8),
    detail: `canvas readback colour samples per category: ${JSON.stringify(Object.fromEntries(categoryPixels))}` });

  const before = new Map<Category, number>();
  const after = new Map<Category, number>();
  const toggles: boolean[] = [];
  for (const category of categories) {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[data-category]')) input.checked = input.dataset.category === category;
    for (const item of categories) renderer.setCategory(item, item === category);
    renderer.draw(); await waitFrame();
    before.set(category, countColor(renderer, RGB[category]));
    renderer.setCategory(category, false); renderer.draw(); await waitFrame();
    const off = countColor(renderer, RGB[category]);
    after.set(category, off);
    toggles.push((before.get(category) ?? 0) > 8 && off === 0);
  }
  emit({ check: 'category-controls-work', pass: toggles.length === categories.length && toggles.every(Boolean),
    detail: `per-category colored sample pixels on→off: ${JSON.stringify(Object.fromEntries(categories.map((category) => [category, [before.get(category), after.get(category)]])))}; pass=${JSON.stringify(Object.fromEntries(categories.map((category, index) => [category, toggles[index]])))}` });
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-category]')) input.checked = true;
  for (const category of categories) renderer.setCategory(category, true);
  renderer.draw(); await waitFrame();

  // selectNext(1) starts at the first public-place in source order; inspect
  // that same feature so the browser check verifies the actual selection.
  const inspectable = features.find((feature) => feature.category === 'public-place');
  if (inspectable) {
    renderer.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
    await waitFrame();
    const info = document.getElementById('feature-info')!.innerText;
    const objectType = inspectable.id < 0n ? 'relation' : inspectable.table === 'planet_osm_point' ? 'node' : 'way';
    const expectedId = `${objectType}/${inspectable.id < 0n ? -inspectable.id : inspectable.id}`;
    emit({ check: 'feature-inspection-preserves-tags', pass: (!inspectable.tags.name || info.includes(inspectable.tags.name))
      && info.includes(inspectable.table) && info.includes(expectedId)
      && Object.entries(inspectable.tags).some(([key, value]) => info.includes(key) && info.includes(value)),
      detail: `keyboard-selected ${inspectable.table}/${expectedId}; ${Object.keys(inspectable.tags).length} source tags available` });
  } else emit({ check: 'feature-inspection-preserves-tags', pass: false, detail: 'no named public-place or tagged building was baked' });

  const initialScale = renderer.camera.scale;
  const initialCoordinate = document.getElementById('coordinate')!.textContent;
  renderer.canvas.focus();
  renderer.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await waitFrame();
  const moved = renderer.camera.centerX !== (15_549_663.07145842 + 15_553_002.656182218) / 2;
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await waitFrame();
  const zoomed = renderer.camera.scale > initialScale;
  renderer.setCoordinateAt([renderer.canvas.clientWidth / 2 + 40, renderer.canvas.clientHeight / 2]);
  const coordinateChanged = document.getElementById('coordinate')!.textContent !== initialCoordinate;
  const scaleCanvas = document.getElementById('scale-bar') as HTMLCanvasElement;
  const scalePixels = readBack(scaleCanvas.getContext('2d')!, 0, 0, scaleCanvas.width, scaleCanvas.height).data;
  let scaleInk = 0;
  for (let i = 0; i < scalePixels.length; i += 4) if (scalePixels[i]! < 120 && scalePixels[i + 1]! < 120 && scalePixels[i + 2]! < 120) scaleInk++;
  const scaleLabel = scaleInk > 20 && scaleCanvas.getAttribute('aria-label')?.includes('EPSG:3857');
  emit({ check: 'pan-zoom-scale-coordinate', pass: moved && zoomed && coordinateChanged && scaleLabel,
    detail: `keyboard pan=${moved}; zoom=${initialScale.toFixed(5)}→${renderer.camera.scale.toFixed(5)}; coordinate changed=${coordinateChanged}; projected bar pixels=${scaleLabel}` });

  const body = document.body.innerText;
  const copyright = [...document.querySelectorAll('a')].some((link) => link.href === 'https://www.openstreetmap.org/copyright');
  emit({ check: 'attribution-odbl-snapshot-scope', pass: copyright && body.includes('OpenStreetMap contributors') && body.includes('ODbL 1.0')
    && body.includes('share-alike') && body.includes('2026.08.31') && body.includes('行政界ではなく') && body.includes('完全性の保証ではありません'),
    detail: 'Attribution link, ODbL/share-alike notice, frozen vintage and non-official/non-complete scope are visible.' });
  const external = performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => new URL(url, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-map-services', pass: external.length === 0, detail: `${external.length} off-origin resources` });

  renderer.resetView();
  const frameTimes: number[] = [], drawTimes: number[] = [];
  await waitFrame();
  for (let i = 0; i < 48; i++) {
    const start = performance.now();
    renderer.camera.centerX += (i % 2 ? -1 : 1) * 10 / renderer.camera.scale;
    renderer.draw(); drawTimes.push(performance.now() - start);
    await waitFrame(); frameTimes.push(performance.now() - start);
  }
  renderer.resetView();
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ info: { renderer: 'Dedicated Canvas 2D OSM source renderer', source: 'Frozen 2026-08-31 GeoParquet, ODbL 1.0', extent: 'Shibuya–Yoyogi 139.685–139.715°E / 35.650–35.675°N', features: features.length, vertices: totalVertices, categoryFeatures: Object.fromEntries(stats), categoryVertices: Object.fromEntries(vertexCounts), sourceRows } });
  emit({ done: true });
}
