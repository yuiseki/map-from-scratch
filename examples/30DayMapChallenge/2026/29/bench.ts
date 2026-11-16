import type { EtopoRenderer } from './renderer.ts';
import { fetchExactRange } from './range.ts';

declare global { interface Window { __mfsEmit?: (payload: string) => void } }

function emit(value: unknown): void { window.__mfsEmit?.(JSON.stringify(value)); }

export async function run(renderer: EtopoRenderer): Promise<void> {
  const data = renderer.data;
  const sourceBytes = data.totalBytes;
  const sourceRanges = data.tileRanges.length + 1;
  const ranges = [data.metadataRange, ...data.tileRanges];
  const bounded206 = ranges.every((range) => range.status === 206 && range.bytes === range.end - range.start + 1 && range.attempts === 1);
  emit({ check: 'source-selection', pass: data.selectedTiles.length === 16 && data.tileRanges.length === 4 && sourceBytes === 2_254_137 && bounded206, detail: `${data.selectedTiles.length} TIFF tiles; ${data.tileRanges.length} tile spans + metadata; ${sourceBytes} B; all ${ranges.length} responses HTTP 206 with exact body lengths=${bounded206}; browser-visible Content-Range=${ranges.every((range) => range.contentRange !== null)}` });

  let calls = 0, cancelled = false;
  const syntheticFetch: typeof fetch = async (_input, init) => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { status: 200 });
    if (init?.headers && new Headers(init.headers).get('Range') !== 'bytes=0-2') throw new Error('synthetic retry changed the requested range');
    return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'Content-Range': 'bytes 0-2/100', 'Content-Length': '3' } });
  };
  let retryPass = false;
  try {
    const result = await fetchExactRange('https://range-fixture.invalid/data', 0, 2, syntheticFetch);
    retryPass = calls === 2 && cancelled && result.attempts === 2 && result.bytes[2] === 3;
  } catch { retryPass = false; }
  emit({ check: 'range-contract', pass: retryPass, detail: `canceled=${cancelled}; calls=${calls}; no full response body was read` });

  const tokyo = renderer.inspectAt(139.7, 35.7);
  const fuji = renderer.inspectAt(138.73, 35.36);
  const trench = renderer.inspectAt(144, 38);
  const sourcePass = tokyo !== null && fuji !== null && trench !== null && Math.abs(tokyo - 37.6047) < 1 && Math.abs(fuji - 3666.336) < 1 && Math.abs(trench + 7534.54) < 1;
  emit({ check: 'decoded-source-samples', pass: sourcePass, detail: `Tokyo ${tokyo} m; Fuji ${fuji} m; Japan Trench ${trench} m` });

  const fujiColor = renderer.readRenderedColor(138.73, 35.36);
  const trenchColor = renderer.readRenderedColor(144, 38);
  const colorPass = !!fujiColor && !!trenchColor && fujiColor[3] === 255 && trenchColor[3] === 255 && fujiColor[0] > trenchColor[0] && trenchColor[2] > fujiColor[2];
  emit({ check: 'raster-colors', pass: colorPass, detail: `Fuji RGBA=${fujiColor}; Japan Trench RGBA=${trenchColor}` });

  const map = document.querySelector<HTMLCanvasElement>('#map');
  const panel = document.querySelector<HTMLElement>('#panel');
  const page = document.body.innerText;
  const creditPass = page.includes('NOAA NCEI') && page.includes('EGM2008') && page.includes('航海用情報');
  emit({ check: 'attribution-caveat', pass: creditPass, detail: creditPass ? 'NOAA citation, vertical reference and non-navigation caveat are visible' : 'source credit or caveat is missing' });

  let selected = false;
  if (map && panel) {
    const sample = renderer.inspectAt(139.7, 35.7);
    const text = panel.textContent ?? '';
    selected = sample !== null && text.includes('標高') && text.includes('139.7000°E');
  }
  emit({ check: 'selected-elevation', pass: selected, detail: selected ? 'selected source pixel is shown with coordinates and elevation' : 'selection detail is missing' });

  const startCamera = renderer.cameraState;
  renderer.zoomBy(2);
  const rect = map?.getBoundingClientRect();
  if (map && rect) {
    map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: rect.left + rect.width * .55, clientY: rect.top + rect.height * .5, bubbles: true }));
    map.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: rect.left + rect.width * .55 + 20, clientY: rect.top + rect.height * .5 + 12, bubbles: true }));
    map.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: rect.left + rect.width * .55 + 20, clientY: rect.top + rect.height * .5 + 12, bubbles: true }));
  }
  const movedCamera = renderer.cameraState;
  const boundedView = !!map && movedCamera.zoom === 2 && (movedCamera.panX !== startCamera.panX || movedCamera.panY !== startCamera.panY) && renderer.isWithinCoverageView();
  renderer.resetView();
  emit({ check: 'bounded-view', pass: boundedView, detail: `zoom=${movedCamera.zoom}; pan=(${movedCamera.panX},${movedCamera.panY}); remains within loaded AOI=${renderer.isWithinCoverageView()}` });

  const frameTimes: number[] = [];
  const drawCpuTimes: number[] = [];
  let previousFrameTimestamp: number | null = null;
  for (let i = 0; i < 180; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame((timestamp) => {
      if (previousFrameTimestamp !== null) frameTimes.push(timestamp - previousFrameTimestamp);
      previousFrameTimestamp = timestamp;
      const started = performance.now(); renderer.draw(); drawCpuTimes.push(performance.now() - started);
      resolve();
    }));
  }
  const gpuTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const value = await renderer.measureGpuDrawMs();
    if (value !== null) gpuTimes.push(value);
  }
  gpuTimes.sort((a, b) => a - b);
  const gpuP95 = gpuTimes.length ? gpuTimes[Math.ceil(gpuTimes.length * .95) - 1]! : null;
  const external = performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => new URL(url).origin !== location.origin);
  const originPass = external.every((url) => new URL(url).origin === 'https://www.ngdc.noaa.gov');
  emit({ check: 'external-origins', pass: originPass, detail: `external requests=${external.length}; only official NOAA origin=${originPass}` });
  emit({ metric: 'frame_ms', values: frameTimes });
  emit({ metric: 'draw_cpu_ms', values: drawCpuTimes });
  if (gpuTimes.length) emit({ metric: 'gpu_ms', values: gpuTimes });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });
  emit({ metric: 'source_bytes', value: sourceBytes });
  emit({ metric: 'source_range_count', value: sourceRanges });
  emit({ info: { gpu: renderer.gpuRenderer, gpuTimerExtension: renderer.gpuTimerAvailable, renderer: 'Float32 R32F texture + NOAA ETOPO fragment shader', source: 'NOAA NCEI ETOPO 2022 30 arc-second GeoTIFF', rangeStatuses: ranges.map((range) => range.status), rangeVisibleContentRange: ranges.map((range) => range.contentRange ?? 'not exposed by CORS'), rangeResponseTypes: ranges.map((range) => range.responseType), rangeLatencyMs: ranges.map((range) => range.elapsedMs), rangeBytes: ranges.map((range) => range.bytes), rangeAttempts: ranges.map((range) => range.attempts) } });
  emit({ done: true });
}
