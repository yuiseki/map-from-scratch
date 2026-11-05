import { benchFramesGpu, emit } from '../../../../harness/page/bench.ts';
import type { CensusCell } from './mesh.ts';
import type { RendererHandle } from './renderer.ts';

const STATUS_CODE: Record<CensusCell['status'], number> = { 'no-row': 0, zero: 1, count: 2, suppressed: 7, unavailable: 8 };
const CLASS_RGB: Record<number, [number, number, number]> = {
  0: [33, 51, 64], 1: [51, 77, 97], 2: [51, 99, 110], 3: [56, 145, 133],
  4: [128, 184, 110], 5: [235, 179, 79], 6: [232, 92, 77], 7: [176, 117, 196], 8: [122, 133, 143],
};

function classFor(cell: CensusCell): number {
  if (cell.status === 'no-row') return 0;
  if (cell.status === 'zero') return 1;
  if (cell.status === 'suppressed') return 7;
  if (cell.status === 'unavailable') return 8;
  let cls = 2;
  for (const threshold of [2, 10, 30, 100]) if ((cell.value ?? 0) > threshold) cls++;
  return cls;
}

function samePixel(pixel: Uint8Array, color: [number, number, number], x: number, y: number, width: number): boolean {
  const i = (Math.floor(y) * width + Math.floor(x)) * 4;
  return Math.abs(pixel[i] - color[0]) < 8 && Math.abs(pixel[i + 1] - color[1]) < 8 && Math.abs(pixel[i + 2] - color[2]) < 8;
}

function visibleOutsidePanel(map: RendererHandle, index: number, panel: HTMLElement, canvas: HTMLCanvasElement): boolean {
  const [x, y] = map.screenPoint(index), [width, height] = map.size(), rect = panel.getBoundingClientRect(), canvasRect = canvas.getBoundingClientRect();
  const cssX = x / devicePixelRatio + canvasRect.left, cssY = y / devicePixelRatio + canvasRect.top;
  return x >= 2 && y >= 2 && x < width - 2 && y < height - 2 && !(cssX >= rect.left && cssX < rect.right && cssY >= rect.top && cssY < rect.bottom);
}

async function settled(map: RendererHandle) {
  await map.device.queue.onSubmittedWorkDone();
  return map.readProjected();
}

export async function run(map: RendererHandle, mounted: number, panel: HTMLElement, canvas: HTMLCanvasElement): Promise<void> {
  const { device, cells, camera } = map;
  device.lost.then((e) => emit({ error: `WebGPU device lost: ${e.message}` }));
  await device.queue.onSubmittedWorkDone();
  emit({ metric: 'first_frame_ms', value: performance.now() - mounted });
  emit({ info: { gpu: map.gpu, webgpu: true, timestampQuery: device.features.has('timestamp-query'), cells: cells.length, cssPixelRatio: devicePixelRatio } });

  const firstPixels = await map.readScreen();
  let output = await settled(map);
  const words = new Uint32Array(output);
  const [width, height] = map.size();
  let sourceClassesMatch = true, visibleCells = 0, mismatch = -1;
  for (let i = 0; i < cells.length; i++) {
    const w = i * 8, expected = classFor(cells[i]);
    if (words[w + 4] !== expected) { sourceClassesMatch = false; mismatch = i; break; }
    if (words[w + 5] === 1) visibleCells++;
  }
  emit({ check: 'source-state-compute', pass: sourceClassesMatch && visibleCells > 0, detail: sourceClassesMatch ? `${visibleCells} projected cells; every GPU class matches source status/value` : `cell ${mismatch}: GPU class ${words[mismatch * 8 + 4]}, source expects ${classFor(cells[mismatch])}` });
  emit({ check: 'webgpu-ready', pass: map.gpu.length > 0, detail: map.gpu || 'adapter did not report an identifier' });

  const initialCamera = { ...map.camera };
  const before = output;
  const movedCamera = { lon: initialCamera.lon + 0.0012, lat: initialCamera.lat - 0.0008, zoom: initialCamera.zoom * 1.7 };
  map.setView(movedCamera); map.draw();
  const movedOutput = await settled(map);
  let changedRecords = 0;
  const beforeFloats = new Float32Array(before), afterFloats = new Float32Array(movedOutput);
  for (let i = 0; i < cells.length; i++) if (Math.abs(beforeFloats[i * 8] - afterFloats[i * 8]) > 0.1 || Math.abs(beforeFloats[i * 8 + 1] - afterFloats[i * 8 + 1]) > 0.1 || words[i * 8 + 5] !== new Uint32Array(movedOutput)[i * 8 + 5]) changedRecords++;
  const movedPixels = await map.readScreen();
  let changedPixels = 0;
  for (let i = 0; i < firstPixels.length; i += 16) if (firstPixels[i] !== movedPixels[i] || firstPixels[i + 1] !== movedPixels[i + 1] || firstPixels[i + 2] !== movedPixels[i + 2]) changedPixels++;
  emit({ check: 'compute-view-change', pass: changedRecords > 0 && changedPixels > 20, detail: `${changedRecords} compute records and ${changedPixels} sampled screen pixels changed after camera pan/zoom` });
  map.setView(initialCamera); map.draw(); output = await settled(map);

  const pixels = await map.readScreen();
  const panelRect = panel.getBoundingClientRect();
  const presentStatuses = [...new Set(cells.map((c) => c.status))];
  const categoryChecks: string[] = [];
  let categoriesMatch = true;
  for (const status of presentStatuses) {
    const index = cells.findIndex((cell, i) => cell.status === status && visibleOutsidePanel(map, i, panel, canvas));
    if (index < 0) { categoryChecks.push(`${status}: no visible sample`); continue; }
    const [x, y] = map.screenPoint(index), cls = classFor(cells[index]), rgb = CLASS_RGB[cls];
    const matches = samePixel(pixels, rgb, x, y, width);
    if (!matches) categoriesMatch = false;
    categoryChecks.push(`${status}: ${matches ? 'pixel ok' : 'pixel mismatch'} at ${Math.round(x)},${Math.round(y)} / ${cells[index].code}`);
  }
  emit({ check: 'screen-cells', pass: categoriesMatch && categoryChecks.every((line) => !line.includes('no visible sample')), detail: categoryChecks.join('; ') || 'no state categories' });

  const sampleIndex = cells.findIndex((cell, i) => cell.status === 'count' && visibleOutsidePanel(map, i, panel, canvas));
  let selectionPass = sampleIndex >= 0;
  let selectionDetail = 'no visible counted cell is available for selection';
  if (sampleIndex >= 0) {
    const [x, y] = map.screenPoint(sampleIndex);
    const picked = map.pick(x, y), cell = cells[sampleIndex];
    const rect = canvas.getBoundingClientRect(), clientX = rect.left + x / devicePixelRatio, clientY = rect.top + y / devicePixelRatio;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77, clientX, clientY }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77, clientX, clientY }));
    map.draw(); await device.queue.onSubmittedWorkDone();
    const detailText = panel.textContent ?? '';
    selectionPass = picked === sampleIndex && detailText.includes(cell.code) && detailText.includes(cell.rawValue ?? '') && detailText.includes('T001142004');
    selectionDetail = `expected ${cell.code}=${cell.rawValue}; pick=${picked}; panel=${detailText}`;
  }
  emit({ check: 'selected-cell', pass: selectionPass, detail: selectionDetail });

  const beforePan = { ...map.camera };
  const rect = canvas.getBoundingClientRect(), cx = rect.left + rect.width * 0.68, cy = rect.top + rect.height * 0.68;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 78, clientX: cx, clientY: cy }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 78, clientX: cx + 26, clientY: cy + 15 }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 78, clientX: cx + 26, clientY: cy + 15 }));
  const afterPan = { ...map.camera };
  canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: -160 }));
  const afterWheel = { ...map.camera };
  map.draw(); await device.queue.onSubmittedWorkDone();
  emit({ check: 'pan-zoom', pass: afterPan.lon !== beforePan.lon && afterPan.lat !== beforePan.lat && afterWheel.zoom > afterPan.zoom, detail: `camera pan (${afterPan.lon - beforePan.lon}, ${afterPan.lat - beforePan.lat}), zoom ${afterPan.zoom} -> ${afterWheel.zoom}` });

  const pageText = document.body.innerText;
  const legendOkay = ['1–2人', '3–10人', '11–30人', '31–100人', '101人以上', '明示的な0人', '秘匿（*）', '表に行なし', '値なし・不明', '2020年10月1日'].every((s) => pageText.includes(s));
  emit({ check: 'legend-caveat', pass: legendOkay, detail: legendOkay ? 'all value states, count bands and census date caveat are visible' : 'one or more legend/caveat labels are missing' });
  const requests = performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => !url.startsWith(location.origin));
  const credit = pageText.includes('e-Stat') && pageText.includes('令和2年国勢調査') && pageText.includes('CC BY 4.0');
  emit({ check: 'attribution-no-external', pass: credit && requests.length === 0, detail: `citation=${credit}; external runtime requests=${requests.length}${requests.length ? ` (${requests.join(', ')})` : ''}` });

  const centerCell = cells.findIndex((cell) => cell.status === 'count' && visibleOutsidePanel(map, cells.indexOf(cell), panel, canvas));
  emit({ info: { selectionSamples: categoryChecks, visibleCells, uiPanelPixels: [panelRect.width, panelRect.height], sampleCell: centerCell >= 0 ? cells[centerCell].code : null, requests: performance.getEntriesByType('resource').length } });

  const path = Array.from({ length: 180 }, (_, i) => {
    const a = i / 179 * Math.PI * 2;
    return { lon: initialCamera.lon + Math.sin(a) * 0.001, lat: initialCamera.lat + Math.cos(a * 2) * 0.0006, zoom: 1 + (1 - Math.cos(a)) * 0.75 };
  });
  await benchFramesGpu(device, path.length, (i, timestamps) => {
    map.setView(path[i]); map.draw(timestamps, true);
  });
  map.setView(initialCamera);
  await benchFramesGpu(device, 60, (_, timestamps) => map.draw(timestamps, true), { prefix: 'whole_' });
  map.setView({ ...initialCamera, zoom: 4 });
  await benchFramesGpu(device, 60, (_, timestamps) => map.draw(timestamps, true), { prefix: 'zoom_' });
  map.setView(initialCamera); map.select(-1); map.draw();
  emit({ done: true });
}
