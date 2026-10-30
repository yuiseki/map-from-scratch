import { emit } from '../../../harness/page/bench.ts';
import type { CesiumPointsGlobe } from './globe.ts';

export async function run(globe: CesiumPointsGlobe, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = globe;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Front point (London: Yellow) rendered
  const pLondon = globe.project(-0.1278, 51.5074);
  const pxLondon = ctx.getImageData(Math.round(pLondon.sx * dpr), Math.round(pLondon.sy * dpr), 1, 1).data;
  const isYellow = pxLondon[0] > 200 && pxLondon[1] > 170 && pxLondon[2] < 60;

  emit({
    check: 'front-points-rendered',
    pass: pLondon.visible && isYellow,
    detail: `london front pt (${Math.round(pLondon.sx)}, ${Math.round(pLondon.sy)}) rgba(${pxLondon.join(',')}) expected yellow #facc15`,
  });

  // Rotate benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    globe.rotateBy(0.02, Math.sin(i * 0.1) * 0.005);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Verification 2: Backside point occluded (rotate 180 degrees)
  // At yaw = Math.PI, London is at the back of the globe
  globe.yaw = Math.PI;
  globe.pitch = 0.35;
  globe.draw();

  const pLondonBack = globe.project(-0.1278, 51.5074);
  const pxLondonBack = ctx.getImageData(Math.round(pLondon.sx * dpr), Math.round(pLondon.sy * dpr), 1, 1).data;
  const isNotYellow = pxLondonBack[0] < 150 || pxLondonBack[1] < 150;

  emit({
    check: 'backside-points-occluded',
    pass: !pLondonBack.visible && isNotYellow,
    detail: `london rotated to back (visible=${pLondonBack.visible}) rgba(${pxLondonBack.join(',')})`,
  });

  // Verification 3: Points rotate synchronously with drag
  globe.yaw = 0.4;
  globe.pitch = 0.2;
  globe.draw();

  const pRotated = globe.project(-0.1278, 51.5074);
  const pxRotated = ctx.getImageData(Math.round(pRotated.sx * dpr), Math.round(pRotated.sy * dpr), 1, 1).data;
  const isRotatedYellow = pxRotated[0] > 180 && pxRotated[1] > 160 && pxRotated[2] < 70;

  emit({
    check: 'points-rotate-with-drag',
    pass: pRotated.visible && isRotatedYellow,
    detail: `london rotated pos (${Math.round(pRotated.sx)}, ${Math.round(pRotated.sy)}) rgba(${pxRotated.join(',')})`,
  });

  emit({ done: true });
}

// Auto-run when imported
const globeInstance = (window as unknown as { __map?: CesiumPointsGlobe }).__map;
if (globeInstance) {
  void run(globeInstance, performance.now());
}
