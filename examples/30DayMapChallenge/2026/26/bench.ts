import { emit } from '../../../../harness/page/bench.ts';
import { DEPTH_COLORS, type FloodRenderer } from './renderer.ts';
import { depthLabel, featureAt } from './flood.ts';

function readPalette(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas readback unavailable');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const counts = new Map<string, number>();
  const extents = { minX: width, minY: height, maxX: -1, maxY: -1 };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const key = `#${[data[offset]!, data[offset + 1]!, data[offset + 2]!].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    if (Object.values(DEPTH_COLORS).includes(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      extents.minX = Math.min(extents.minX, x); extents.maxX = Math.max(extents.maxX, x);
      extents.minY = Math.min(extents.minY, y); extents.maxY = Math.max(extents.maxY, y);
    }
  }
  return { counts, extents };
}

export async function run(renderer: FloodRenderer): Promise<void> {
  const { data } = renderer;
  const pixels = readPalette(renderer.canvas);
  const classes = [1, 2, 3, 4, 5, 6] as const;
  const counts = Object.fromEntries(classes.map((rank) => [rank, data.features.filter((f) => f.depthClass === rank).length]));
  emit({ metric: 'source_features', value: data.features.length });
  emit({ metric: 'unique_feature_ids', value: new Set(data.features.map((f) => f.id)).size });
  for (const rank of classes) emit({ metric: `depth_class_${rank}_features`, value: counts[rank] });
  emit({ metric: 'projected_flood_pixels', value: [...pixels.counts.values()].reduce((a, b) => a + b, 0) });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });

  const sourcePass = data.features.length === 2_264 && new Set(data.features.map((f) => f.id)).size === 2_264
    && data.category === 'maximum' && data.features.every((f) => f.river === '荒川' && f.manager === '関東地方整備局');
  emit({ check: 'source-scenario-and-feature-preservation', pass: sourcePass,
    detail: `${data.features.length} unique polygons; category=${data.category}; all river/manager fields match; rank counts ${JSON.stringify(counts)}` });
  const classPixels = classes.map((rank) => pixels.counts.get(DEPTH_COLORS[rank]!) ?? 0);
  const legendPass = classes.every((rank) => document.body.innerText.includes(depthLabel(rank)))
    && classPixels.slice(0, 5).every((count) => count > 0) && classPixels[5] === 0;
  emit({ check: 'ordered-ranks-and-rendered-pixels', pass: legendPass,
    detail: `legend defines ranks 1–6; canvas rank pixels=${classPixels.join(',')}; source ranks=${classes.map((rank) => counts[rank]).join(',')}` });
  emit({ check: 'unknown-zero-and-outside-semantics', pass: document.body.innerText.includes('深さ0 mや安全を意味しません')
    && document.body.innerText.includes('住所ごとの保証')
    && data.features.every((f) => f.depthClass !== 0),
    detail: 'No polygon is stated as zero depth or a safety guarantee; source rank zero is not used.' });

  const sample = data.features.find((feature) => featureAt(data.features, feature.pickPoint)?.id === feature.id) ?? data.features.at(-1)!;
  const [sampleX, sampleY] = renderer.screenPositionFor(sample.pickPoint);
  renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: sampleX, clientY: sampleY, pointerId: 29, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: sampleX, clientY: sampleY, pointerId: 29, bubbles: true }));
  const inspected = featureAt(data.features, sample.pickPoint);
  const inspectText = document.getElementById('selected')!.innerText;
  const inspectPass = inspected?.id === sample.id && inspectText.includes(sample.river)
    && inspectText.includes(sample.manager) && inspectText.includes(String(sample.rawDepth))
    && inspectText.includes('想定最大規模');
  emit({ check: 'polygon-inspection-retains-source-fields', pass: inspectPass,
    detail: `${sample.id}: ${sample.river}, ${sample.manager}, ${sample.rawDepth} (${depthLabel(sample.rawDepth)})` });

  const extent = pixels.extents;
  const pixelExtentPass = extent.maxX > extent.minX && extent.maxY > extent.minY
    && extent.maxX - extent.minX > renderer.canvas.width * 0.35
    && extent.maxY - extent.minY > renderer.canvas.height * 0.35;
  emit({ check: 'clipping-and-geographic-composition', pass: pixelExtentPass && data.features.every((feature) => feature.polygons.flat(2).every(([lon, lat]) =>
    lon >= data.bounds[0] - 1e-8 && lon <= data.bounds[2] + 1e-8 && lat >= data.bounds[1] - 1e-8 && lat <= data.bounds[3] + 1e-8)),
    detail: `source geometry is clipped to bbox; flood pixel extent ${extent.minX},${extent.minY}–${extent.maxX},${extent.maxY}` });

  const zoomBefore = renderer.state.zoom;
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const zoomPass = renderer.state.zoom > zoomBefore;
  renderer.resetView();
  const panBefore = { x: renderer.state.panX, y: renderer.state.panY };
  const rect = renderer.canvas.getBoundingClientRect();
  const cx = rect.left + rect.width * .75, cy = rect.top + rect.height * .72;
  renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 19, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + 30, clientY: cy + 20, pointerId: 19, bubbles: true }));
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 30, clientY: cy + 20, pointerId: 19, bubbles: true }));
  const panPass = renderer.state.panX !== panBefore.x && renderer.state.panY !== panBefore.y;
  emit({ check: 'pan-zoom-and-coordinate-context', pass: zoomPass && panPass
    && document.getElementById('coordinates')!.textContent !== null
    && document.body.innerText.includes('500 m'),
    detail: `zoom changed=${zoomPass}; pan changed=${panPass}; coordinate field and scale bar are present` });
  renderer.resetView();

  const body = document.body.innerText;
  emit({ check: 'modeled-scenario-and-license', pass: body.includes('モデル上の想定') && body.includes('実際の浸水記録')
    && body.includes('予報、警報ではありません') && body.includes('CC BY 4.0')
    && body.includes('国土数値情報 洪水浸水想定区域データ')
    && document.querySelector('a[href*="KsjTmplt-A31a-2025.html"]') !== null,
    detail: 'Scenario disclaimer, source attribution, license and official source link are visible.' });
  const offOrigin = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-requests', pass: offOrigin.length === 0, detail: `${offOrigin.length} off-origin requests` });

  const frameTimes: number[] = [], drawTimes: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 40; i++) {
    const start = performance.now(); renderer.draw(); drawTimes.push(performance.now() - start);
    const frameStart = performance.now(); await new Promise(requestAnimationFrame); frameTimes.push(performance.now() - frameStart);
  }
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ metric: 'draw_cpu_ms', values: drawTimes });
  emit({ info: { renderer: 'Dedicated Canvas 2D flood raster + source-geometry picking', sourceFeatures: data.features.length,
    depthFeatures: counts, category: data.category, bbox: data.bounds, selectionIsAdministrativeBoundary: false,
    interpretation: 'modeled maximum-scale inundation assumption; absence is not zero/safety' } });
  emit({ done: true });
}
