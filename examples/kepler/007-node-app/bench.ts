// examples/kepler/007-node-app/bench.ts
import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { KeplerMap } from './map.ts';

export async function run(map: KeplerMap, firstFrameMs: number): Promise<void> {
  emit({ info: { gpu: glRenderer(map.gl), points: map.pointCount } });
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // 1. Verification: report-banner-rendered
  const banner = document.getElementById('report-banner');
  const hasBanner = Boolean(banner && banner.textContent?.includes('California Seismic Hazard Report'));

  emit({
    check: 'report-banner-rendered',
    pass: hasBanner,
    detail: `hasBanner=${hasBanner}`,
  });

  // 2. Verification: analytics-summary-mounted
  const sidebar = document.getElementById('sidebar');
  const has54k = Boolean(sidebar?.textContent?.includes('54,936'));
  const hasM72 = Boolean(sidebar?.textContent?.includes('M7.2'));

  emit({
    check: 'analytics-summary-mounted',
    pass: has54k && hasM72,
    detail: `has54k=${has54k}, hasM72=${hasM72}`,
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
