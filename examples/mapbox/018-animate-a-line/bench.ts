import { emit } from '../../../harness/page/bench.ts';
import type { MapboxAnimatedLineMap } from './map.ts';

export async function run(map: MapboxAnimatedLineMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  // Take control of animation for deterministic benchmark
  map.isAnimating = false;

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Origin marker / route rendered at SF
  map.progress = 0.05;
  map.draw();
  const origin = map.route[0];
  const origPos = map.getScreenCoords(origin[0], origin[1]);
  const pxOrig = ctx.getImageData(Math.round(origPos.x * dpr), Math.round(origPos.y * dpr), 1, 1).data;
  const isCyanOrig = pxOrig[1] > 150 && pxOrig[2] > 200;

  emit({
    check: 'origin-marker-rendered',
    pass: isCyanOrig,
    detail: `origin SF pos=(${Math.round(origPos.x)}, ${Math.round(origPos.y)}) rgba(${pxOrig.join(',')})`,
  });

  // Animated line streaming benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.progress = (i / 60) * 0.8;
    map.draw();
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Verification 2: Line advances with time across midpoint (index 250)
  const mid = map.route[250];
  const midPos = map.getScreenCoords(mid[0], mid[1]);

  map.progress = 0.15; // Midpoint not reached yet
  map.draw();
  const pxBefore = ctx.getImageData(Math.round(midPos.x * dpr), Math.round(midPos.y * dpr), 1, 1).data;
  const notCyanBefore = pxBefore[1] < 120 || pxBefore[2] < 140;

  map.progress = 0.65; // Midpoint reached and drawn
  map.draw();
  const pxAfter = ctx.getImageData(Math.round(midPos.x * dpr), Math.round(midPos.y * dpr), 1, 1).data;
  const isCyanAfter = pxAfter[1] > 170 && pxAfter[2] > 190;

  emit({
    check: 'line-advances-with-time',
    pass: notCyanBefore && isCyanAfter,
    detail: `before rgba(${pxBefore.join(',')}), after rgba(${pxAfter.join(',')})`,
  });

  // Verification 3: Head marker rendered at current head
  map.progress = 0.5;
  map.draw();
  const head = map.route[250];
  const headPos = map.getScreenCoords(head[0], head[1]);
  const pxHead = ctx.getImageData(Math.round(headPos.x * dpr), Math.round(headPos.y * dpr), 1, 1).data;
  const isWhiteHead = pxHead[0] > 200 && pxHead[1] > 200 && pxHead[2] > 200;

  emit({
    check: 'head-marker-rendered',
    pass: isWhiteHead,
    detail: `head marker pos=(${Math.round(headPos.x)}, ${Math.round(headPos.y)}) rgba(${pxHead.join(',')}) expected white center`,
  });

  emit({ done: true });
}

// Auto-run when imported
const mapInstance = (window as unknown as { __map?: MapboxAnimatedLineMap }).__map;
if (mapInstance) {
  void run(mapInstance, performance.now());
}
