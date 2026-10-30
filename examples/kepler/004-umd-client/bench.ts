// examples/kepler/004-umd-client/bench.ts
import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { KeplerMap } from './map.ts';

export async function run(map: KeplerMap, firstFrameMs: number): Promise<void> {
  emit({ info: { gpu: glRenderer(map.gl), points: map.pointCount } });
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // 1. Verification: umd-factory-exists
  const keplerGlobal = (window as unknown as { KeplerGl?: { mount?: unknown } }).KeplerGl;
  const hasMount = typeof keplerGlobal?.mount === 'function';
  emit({
    check: 'umd-factory-exists',
    pass: hasMount,
    detail: `hasMount=${hasMount}`,
  });

  // 2. Verification: dynamic-dom-injected
  const container = document.getElementById('kepler-container');
  const appEl = container?.querySelector('.kepler-app');
  const canvasEl = container?.querySelector('.kepler-canvas');
  const domInjected = Boolean(container && appEl && canvasEl);

  emit({
    check: 'dynamic-dom-injected',
    pass: domInjected,
    detail: `container=${Boolean(container)}, app=${Boolean(appEl)}, canvas=${Boolean(canvasEl)}`,
  });

  // 3. Verification: earthquakes-rendered
  const canvas = map.canvas;
  const cw = canvas.width;
  const ch = canvas.height;
  let nonBgPixels = 0;

  for (let dy = -60; dy <= 60; dy += 8) {
    for (let dx = -60; dx <= 60; dx += 8) {
      const px = map.readPixel(Math.round(cw / 2 + dx), Math.round(ch / 2 + dy));
      if (px[0] > 70) {
        nonBgPixels++;
      }
    }
  }

  emit({
    check: 'earthquakes-rendered',
    pass: nonBgPixels > 5 && map.pointCount === 54936,
    detail: `pointCount=${map.pointCount}, nonBgPixels=${nonBgPixels}`,
  });

  // 4. Pan benchmark
  const redrawTimes: number[] = [];
  const intervals: number[] = [];
  let lastFrameTime = performance.now();

  for (let f = 0; f < 60; f++) {
    const start = performance.now();
    map.panBy(3, 1);
    const end = performance.now();
    redrawTimes.push(end - start);

    await new Promise(requestAnimationFrame);
    const now = performance.now();
    intervals.push(now - lastFrameTime);
    lastFrameTime = now;
  }

  redrawTimes.sort((a, b) => a - b);
  intervals.sort((a, b) => a - b);

  const p95Redraw = redrawTimes[Math.floor(redrawTimes.length * 0.95)];
  const p95Interval = intervals[Math.floor(intervals.length * 0.95)];

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: intervals });

  emit({
    check: 'pan-and-zoom',
    pass: p95Redraw < 16.0,
    detail: `p95Redraw=${p95Redraw.toFixed(2)}ms, p95Interval=${p95Interval.toFixed(2)}ms`,
  });

  emit({ done: true });
}
