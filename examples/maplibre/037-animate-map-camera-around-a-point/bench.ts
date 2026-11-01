// examples/maplibre/037-animate-map-camera-around-a-point/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { CameraRotateMap } from './rotate.ts';

export async function runBench(map: CameraRotateMap, firstFrameMs: number) {
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

  // Verification Check 2: Center focal point drawn
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  const centerPx = map.readPixel(cx, cy);
  // Red dot: r > 200, g < 100, b < 100
  const focalPointDrawn = centerPx[0] > 180 && centerPx[1] < 100;
  emit({
    check: 'center-focal-point-drawn',
    pass: focalPointDrawn,
    detail: `Focal point pixel: RGBA(${centerPx.join(',')})`,
  });

  // Scenario 2: Rotation loop benchmark & Verification Check 3: Camera rotates
  // Sample position to the east (towards Atlantic ocean at zoom 2)
  const testOffsetX = 240;
  const testOffsetY = 0;
  const initPx = map.readPixel(cx + testOffsetX, cy + testOffsetY);

  const redrawTimes: number[] = [];
  const intervals: number[] = [];
  let lastTime = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.step(3.0); // 3.0 deg per step = 180 deg rotation total
    const t1 = performance.now();
    redrawTimes.push(t1 - t0);

    const now = performance.now();
    intervals.push(now - lastTime);
    lastTime = now;

    await new Promise((r) => requestAnimationFrame(r));
  }

  const rotatedPx = map.readPixel(cx + testOffsetX, cy + testOffsetY);
  const bearing = map.getBearing();
  const diff = Math.abs(initPx[0] - rotatedPx[0]) + Math.abs(initPx[1] - rotatedPx[1]) + Math.abs(initPx[2] - rotatedPx[2]);
  const rotatedOk = bearing > 0 && diff > 10;

  emit({
    check: 'camera-rotates',
    pass: rotatedOk,
    detail: `Bearing reached: ${bearing.toFixed(1)}°, offset (${testOffsetX}, ${testOffsetY}), pixel change: RGBA(${initPx.join(',')}) -> RGBA(${rotatedPx.join(',')}), diff: ${diff}`,
  });

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: intervals });
  emit({ done: true });
}
