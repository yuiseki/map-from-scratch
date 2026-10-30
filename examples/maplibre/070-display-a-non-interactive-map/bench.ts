import { emit } from '../../../harness/page/bench.ts';
import type { StaticMap } from './static-map.ts';

export async function run(map: StaticMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Center [74.5, 40] is land, [74.5, 0] is ocean
  const [centerX, centerY] = map.getScreenPos(74.5, 40.0);
  const pxCenter = ctx.getImageData(Math.round(centerX * dpr), Math.round(centerY * dpr), 1, 1).data;
  const isLand = pxCenter[0] > 220 && pxCenter[1] > 220 && pxCenter[2] > 210;

  const [oceanX, oceanY] = map.getScreenPos(74.5, 0.0);
  const pxOcean = ctx.getImageData(Math.round(oceanX * dpr), Math.round(oceanY * dpr), 1, 1).data;
  const isOcean = pxOcean[0] < 190 && pxOcean[1] > 190 && pxOcean[2] > 210;

  emit({
    check: 'map-rendered-at-target',
    pass: isLand && isOcean,
    detail: `land rgba(${pxCenter.join(',')}) at center [74.5, 40], ocean rgba(${pxOcean.join(',')}) at [74.5, 0]`,
  });

  // Verification 2: Non-interactive: dispatch gestures and verify view remains static
  const startMx = map.center[0];
  const startMy = map.center[1];
  const startZoom = map.zoom;

  // Attempt pointer drag
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 512, clientY: 384, pointerId: 1 }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 612, clientY: 484, pointerId: 1 }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 612, clientY: 484, pointerId: 1 }));

  // Attempt wheel zoom
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));

  const centerUnchanged = map.center[0] === startMx && map.center[1] === startMy;
  const zoomUnchanged = map.zoom === startZoom;

  const pxAfter = ctx.getImageData(Math.round(centerX * dpr), Math.round(centerY * dpr), 1, 1).data;
  const isStillLand = pxAfter[0] > 220 && pxAfter[1] > 220 && pxAfter[2] > 210;

  emit({
    check: 'gestures-ignored',
    pass: !map.interactive && centerUnchanged && zoomUnchanged && isStillLand,
    detail: `interactive=${map.interactive}, centerUnchanged=${centerUnchanged}, zoomUnchanged=${zoomUnchanged}`,
  });

  // Measure static render time
  const redrawTimes: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    map.draw();
    redrawTimes.push(performance.now() - t0);
  }
  emit({ metric: 'redraw_ms', values: redrawTimes });

  emit({ done: true });
}
