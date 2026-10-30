import { emit } from '../../../harness/page/bench.ts';
import type { OpenGlobusVectorGlobe } from './globe.ts';

export async function run(globe: OpenGlobusVectorGlobe, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = globe;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Vector borders rendered at Morocco / Mediterranean border [-2.1699, 35.1685]
  const pFront = globe.project(-2.1699, 35.1685);
  const pxFront = ctx.getImageData(Math.round(pFront.sx * dpr), Math.round(pFront.sy * dpr), 1, 1).data;
  const isCyan = pxFront[1] > 140 && pxFront[2] > 170;

  emit({
    check: 'vector-borders-rendered',
    pass: pFront.visible && isCyan,
    detail: `border pos=(${Math.round(pFront.sx)}, ${Math.round(pFront.sy)}) rgba(${pxFront.join(',')}) expected cyan #06b6d4`,
  });

  // Verification 2: Globe horizon culling (space background outside globe)
  const pxSpace = ctx.getImageData(Math.round(20 * dpr), Math.round(20 * dpr), 1, 1).data;
  const isSpaceDark = pxSpace[0] < 15 && pxSpace[1] < 20 && pxSpace[2] < 30;

  emit({
    check: 'globe-horizon-culling',
    pass: isSpaceDark,
    detail: `space corner pos=(20, 20) rgba(${pxSpace.join(',')}) expected #030712`,
  });

  // Rotate benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    globe.rotateBy(0.015, Math.sin(i * 0.1) * 0.005);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Verification 3: Vector borders rotate with drag
  globe.yaw = 0.35;
  globe.pitch = 0.2;
  globe.draw();

  const pRotated = globe.project(-2.1699, 35.1685);
  const pxRotated = ctx.getImageData(Math.round(pRotated.sx * dpr), Math.round(pRotated.sy * dpr), 1, 1).data;
  const isRotatedCyan = pxRotated[1] > 130 && pxRotated[2] > 160;

  emit({
    check: 'vector-globe-rotates',
    pass: pRotated.visible && isRotatedCyan,
    detail: `rotated border pos=(${Math.round(pRotated.sx)}, ${Math.round(pRotated.sy)}) rgba(${pxRotated.join(',')})`,
  });

  emit({ done: true });
}

// Auto-run when imported
const globeInstance = (window as unknown as { __map?: OpenGlobusVectorGlobe }).__map;
if (globeInstance) {
  void run(globeInstance, performance.now());
}
