// examples/kepler/008-custom-map-style/bench.ts
import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { KeplerCustomStyleMap } from './map.ts';

export async function runBench(map: KeplerCustomStyleMap, firstFrameMs: number) {
  emit({ info: { gpu: glRenderer(map.gl) } });
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Verification Check 1: DOM Elements Ready
  const sidebar = document.getElementById('sidebar');
  const styleCards = document.querySelectorAll('.style-card');
  const domReady = !!sidebar && styleCards.length === 4;
  emit({
    check: 'dom-elements-ready',
    pass: domReady,
    detail: `Found sidebar: ${!!sidebar}, styleCards count: ${styleCards.length}`,
  });

  // Verification Check 2: Initial Dark Style Rendered
  // Dark style ocean is dark: [0.08, 0.09, 0.12] -> ~20-30 in 0-255
  const oceanPx = map.readPixel(50, 50);
  const isDarkOcean = oceanPx[0] < 50 && oceanPx[1] < 50 && oceanPx[2] < 60;
  emit({
    check: 'initial-dark-style-rendered',
    pass: isDarkOcean,
    detail: `Ocean pixel RGBA: ${oceanPx.join(',')}`,
  });

  // Verification Check 3: Style Switch to Light
  map.setStyle('light');
  const lightOceanPx = map.readPixel(50, 50);
  // Positron ocean is [0.92, 0.94, 0.96] -> ~230-245
  const isLightOcean = lightOceanPx[0] > 200 && lightOceanPx[1] > 200 && lightOceanPx[2] > 200;
  emit({
    check: 'style-switch-light',
    pass: isLightOcean,
    detail: `Light ocean pixel RGBA: ${lightOceanPx.join(',')}`,
  });

  // Revert back to dark for further checks
  map.setStyle('dark');

  // Verification Check 4: Toggle Land Layer
  // Sample a point in land (California region)
  const landPxBefore = map.readPixel(600, 400);
  map.setLayerVisibility('land', false);
  const landPxAfter = map.readPixel(600, 400);
  const landChanged = landPxBefore[0] !== landPxAfter[0] || landPxBefore[1] !== landPxAfter[1] || landPxBefore[2] !== landPxAfter[2];
  map.setLayerVisibility('land', true); // restore
  emit({
    check: 'toggle-land-layer',
    pass: landChanged,
    detail: `Land before: ${landPxBefore.join(',')}, after hide: ${landPxAfter.join(',')}`,
  });

  // Scenario 2: Pan & Smooth Interaction Benchmark
  const redrawTimes: number[] = [];
  const intervals: number[] = [];
  let lastTime = performance.now();

  const pxBeforePan = map.readPixel(600, 400);

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(2, 1);
    const t1 = performance.now();
    redrawTimes.push(t1 - t0);

    const now = performance.now();
    intervals.push(now - lastTime);
    lastTime = now;

    await new Promise((r) => requestAnimationFrame(r));
  }

  const pxAfterPan = map.readPixel(600, 400);
  const pannedOk = pxBeforePan.join(',') !== pxAfterPan.join(',');

  emit({
    check: 'smooth-pan',
    pass: pannedOk,
    detail: `Panned pixel before: ${pxBeforePan.join(',')}, after: ${pxAfterPan.join(',')}`,
  });

  // The harness takes every sample and computes the percentiles itself.
  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: intervals });
  emit({ done: true });
}
