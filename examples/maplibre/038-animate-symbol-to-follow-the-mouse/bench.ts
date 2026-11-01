// examples/maplibre/038-animate-symbol-to-follow-the-mouse/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { MouseFollowMap } from './mouse.ts';

export async function runBench(map: MouseFollowMap, firstFrameMs: number) {
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

  // Verification Check 2: Initial symbol drawn
  // Center position should have marker (#3887be: ~56, 135, 190)
  const [initX, initY] = map.getCursorPos();
  const initMarkerPx = map.readPixel(Math.round(initX), Math.round(initY));
  // White dot or blue circle
  const initialDrawn = initMarkerPx[2] > 150;
  emit({
    check: 'initial-symbol-drawn',
    pass: initialDrawn,
    detail: `Initial center pixel: RGBA(${initMarkerPx.join(',')})`,
  });

  // Scenario 2: Mouse tracking loop & Verification Check 3: Symbol follows mouse
  const targetX = initX + 150;
  const targetY = initY + 100;

  const redrawTimes: number[] = [];
  const intervals: number[] = [];
  let lastTime = performance.now();

  for (let i = 0; i < 60; i++) {
    const t = (i + 1) / 60;
    const curX = initX + (targetX - initX) * t;
    const curY = initY + (targetY - initY) * t;

    const t0 = performance.now();
    map.setCursorPos(curX, curY);
    const t1 = performance.now();
    redrawTimes.push(t1 - t0);

    const now = performance.now();
    intervals.push(now - lastTime);
    lastTime = now;

    await new Promise((r) => requestAnimationFrame(r));
  }

  // Verify target location has marker color
  const targetPx = map.readPixel(Math.round(targetX), Math.round(targetY));
  const oldPosPx = map.readPixel(Math.round(initX), Math.round(initY));
  const followedOk = targetPx[2] > 150 && !(oldPosPx[0] === 56 && oldPosPx[1] === 135 && oldPosPx[2] === 190);

  emit({
    check: 'symbol-follows-mouse',
    pass: followedOk,
    detail: `Moved to (${targetX.toFixed(0)}, ${targetY.toFixed(0)}), target pixel: RGBA(${targetPx.join(',')}), old pos pixel: RGBA(${oldPosPx.join(',')})`,
  });

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: intervals });
  emit({ done: true });
}
