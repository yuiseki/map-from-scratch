import { emit } from '../../../harness/page/bench.ts';
import type { CesiumGlobe } from './globe.ts';

function readPixel(ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number): [number, number, number, number] {
  const img = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1);
  return [img.data[0], img.data[1], img.data[2], img.data[3]];
}

export async function run(globe: CesiumGlobe, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = globe;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const cx = w / 2;
  const cy = h / 2;

  // Check 1: Space dark background at corners and Earth sphere at center
  const pxSpace = readPixel(ctx, 40, 40, dpr);
  const isSpace = pxSpace[0] < 25 && pxSpace[1] < 25 && pxSpace[2] < 35;

  const pxCenter = readPixel(ctx, cx, cy, dpr);
  const isGlobeCenter = pxCenter[1] > 35 || pxCenter[2] > 55;

  emit({
    check: 'globe-rendered',
    pass: isSpace && isGlobeCenter,
    detail: `space rgba(${pxSpace.join(',')}), globe center rgba(${pxCenter.join(',')})`,
  });

  // Benchmark rotation performance over 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    globe.rotateBy(0.03, Math.sin(i * 0.1) * 0.01);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Check 2: Rotation changes pixel color
  globe.yaw = 0.3; // Orient towards Africa/Europe
  globe.pitch = 0.2;
  globe.zoomScale = 1.0;
  globe.draw();
  const c0 = readPixel(ctx, cx, cy, dpr);

  globe.yaw = 3.5; // Rotate ~180° towards Pacific Ocean
  globe.pitch = 0.0;
  globe.draw();
  const c1 = readPixel(ctx, cx, cy, dpr);

  const changed = c0[0] !== c1[0] || c0[1] !== c1[1] || c0[2] !== c1[2];
  emit({
    check: 'globe-rotates-with-drag',
    pass: changed,
    detail: `land at Africa rgba(${c0.join(',')}) vs ocean at Pacific rgba(${c1.join(',')})`,
  });

  // Check 3: Zoom-in expands globe radius onto outer pixels
  globe.zoomScale = 1.0;
  globe.draw();
  const baseRadius = Math.min(w, h) * 0.38;
  const outerX = cx + baseRadius * 1.15;
  const pxOuterBefore = readPixel(ctx, outerX, cy, dpr);
  const wasSpace = pxOuterBefore[0] < 25 && pxOuterBefore[1] < 25 && pxOuterBefore[2] < 35;

  globe.zoomScale = 1.5; // zoom in
  globe.draw();
  const pxOuterAfter = readPixel(ctx, outerX, cy, dpr);
  const nowGlobe = pxOuterAfter[1] > 35 || pxOuterAfter[2] > 55;

  emit({
    check: 'globe-scales-with-zoom',
    pass: wasSpace && nowGlobe,
    detail: `before zoom rgba(${pxOuterBefore.join(',')}) -> after zoom rgba(${pxOuterAfter.join(',')})`,
  });

  emit({ done: true });
}
