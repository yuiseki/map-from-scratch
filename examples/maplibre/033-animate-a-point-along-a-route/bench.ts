// examples/maplibre/033-animate-a-point-along-a-route/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { RouteAnimationMap } from './route.ts';

export async function runBench(map: RouteAnimationMap, firstFrameMs: number) {
  // Scenario 1: First frame metric
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Verification Check 1: Canvas rendered
  const canvas = map.canvas;
  const canvasOk = canvas && canvas.width > 0 && canvas.height > 0;
  emit({
    check: 'canvas-rendered',
    pass: canvasOk,
    detail: `Canvas dimensions: ${canvas.width}x${canvas.height}`,
  });

  // Verification Check 2: Route drawn
  // Route color is #4882c5 (~72, 130, 197). Sample near midpoint between SF and DC (Kansas/Nebraska region)
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  // Scan a vertical slice around center to find blue route line pixel
  let foundRoute = false;
  let sampleRoutePx: number[] = [];
  for (let dy = -60; dy <= 60; dy++) {
    const px = map.readPixel(cx, cy + dy);
    if (px[2] > 170 && px[0] > 40 && px[1] > 90) {
      foundRoute = true;
      sampleRoutePx = [px[0], px[1], px[2]];
      break;
    }
  }
  emit({
    check: 'route-drawn',
    pass: foundRoute,
    detail: `Route line pixel: RGB(${sampleRoutePx.join(',') || 'not found'})`,
  });

  // Scenario 2: Anim loop benchmark & Verification Check 3: Point movement
  const [initX, initY] = map.getMarkerScreenPos();
  const initPx = map.readPixel(Math.round(initX), Math.round(initY));

  const redrawTimes: number[] = [];
  const intervals: number[] = [];
  let lastTime = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.step();
    const t1 = performance.now();
    redrawTimes.push(t1 - t0);

    const now = performance.now();
    intervals.push(now - lastTime);
    lastTime = now;

    await new Promise((r) => requestAnimationFrame(r));
  }

  const [movedX, movedY] = map.getMarkerScreenPos();
  const dist = Math.hypot(movedX - initX, movedY - initY);
  const stepCount = map.getStep();
  const movedOk = stepCount >= 60 && dist > 15;

  emit({
    check: 'point-movement',
    pass: movedOk,
    detail: `Step: ${stepCount}, marker moved by ${dist.toFixed(1)} px from (${initX.toFixed(0)}, ${initY.toFixed(0)}) to (${movedX.toFixed(0)}, ${movedY.toFixed(0)})`,
  });

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: intervals });
  emit({ done: true });
}
