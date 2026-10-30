// examples/kepler/002-open-modal/bench.ts
import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { KeplerMap } from './map.ts';

export async function run(map: KeplerMap, firstFrameMs: number): Promise<void> {
  emit({ info: { gpu: glRenderer(map.gl), points: map.pointCount } });
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const modalOverlay = document.getElementById('modal-overlay');
  const openBtn = document.getElementById('open-modal-btn');
  const closeBtn = document.getElementById('close-modal-btn');

  // 1. Verification: modal-initially-closed
  const initiallyClosed = Boolean(modalOverlay?.classList.contains('hidden'));
  emit({
    check: 'modal-initially-closed',
    pass: initiallyClosed,
    detail: `initiallyClosed=${initiallyClosed}`,
  });

  // 2. Open modal and verify rendered points
  openBtn?.click();
  await new Promise((r) => setTimeout(r, 50));
  map.resize();
  map.draw();

  const isModalOpen = !modalOverlay?.classList.contains('hidden');
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
    check: 'modal-open-and-rendered',
    pass: isModalOpen && nonBgPixels > 5,
    detail: `isModalOpen=${isModalOpen}, nonBgPixels=${nonBgPixels}`,
  });

  // 3. Close modal
  closeBtn?.click();
  const isClosed = Boolean(modalOverlay?.classList.contains('hidden'));
  emit({
    check: 'modal-close',
    pass: isClosed,
    detail: `isClosed=${isClosed}`,
  });

  // 4. Reopen and verify state preservation
  openBtn?.click();
  await new Promise((r) => setTimeout(r, 50));
  map.resize();

  emit({
    check: 'state-preserved',
    pass: map.getZoom() > 5.0 && map.pointCount === 54936,
    detail: `zoom=${map.getZoom().toFixed(2)}, pointCount=${map.pointCount}`,
  });

  // 5. Pan benchmark
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
