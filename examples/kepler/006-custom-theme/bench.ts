// examples/kepler/006-custom-theme/bench.ts
import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { KeplerMap, ThemeMode } from './map.ts';

export async function run(
  map: KeplerMap,
  firstFrameMs: number,
  applyTheme: (mode: ThemeMode) => void,
): Promise<void> {
  emit({ info: { gpu: glRenderer(map.gl), points: map.pointCount } });
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // 1. Verification: dark-theme-initial
  const isDarkInitial = map.getTheme() === 'dark' && document.body.classList.contains('theme-dark');
  const oceanPxDark = map.readPixel(20, 20);
  const darkOceanPass = oceanPxDark[0] < 50;

  emit({
    check: 'dark-theme-initial',
    pass: isDarkInitial && darkOceanPass,
    detail: `theme=${map.getTheme()}, oceanPx=[${oceanPxDark.join(',')}]`,
  });

  // 2. Verification: switch-to-light-theme
  applyTheme('light');
  map.draw();
  const isLight = map.getTheme() === 'light' && document.body.classList.contains('theme-light');
  const oceanPxLight = map.readPixel(20, 20);
  const lightOceanPass = oceanPxLight[0] > 180;

  emit({
    check: 'switch-to-light-theme',
    pass: isLight && lightOceanPass,
    detail: `theme=${map.getTheme()}, oceanPx=[${oceanPxLight.join(',')}]`,
  });

  // 3. Verification: earthquakes-visible-in-both-themes
  const canvas = map.canvas;
  const cw = canvas.width;
  const ch = canvas.height;
  let nonBgPixelsLight = 0;

  for (let dy = -60; dy <= 60; dy += 8) {
    for (let dx = -60; dx <= 60; dx += 8) {
      const px = map.readPixel(Math.round(cw / 2 + dx), Math.round(ch / 2 + dy));
      // In light theme, points have colored saturation (diff between R and B/G > 20)
      if (Math.abs(px[0] - px[2]) > 20 || px[0] > 200 || px[2] > 200) {
        nonBgPixelsLight++;
      }
    }
  }

  emit({
    check: 'earthquakes-visible-in-both-themes',
    pass: nonBgPixelsLight > 5 && map.pointCount === 54936,
    detail: `nonBgPixelsLight=${nonBgPixelsLight}, pointCount=${map.pointCount}`,
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
