import { emit } from '../../../harness/page/bench.ts';
import type { Forge3dPointCloud } from './cloud.ts';

export async function run(cloud: Forge3dPointCloud, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = cloud;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Summit rim peak (Point 0: x=0, y=-650, z=820) rendered with high elevation color
  const pPeak = cloud.project(0, -650, 820);
  const pxPeak = ctx.getImageData(Math.round(pPeak.sx * dpr), Math.round(pPeak.sy * dpr), 1, 1).data;
  const isSummitWhite = pxPeak[0] > 180 && pxPeak[1] > 190 && pxPeak[2] > 200;

  emit({
    check: 'point-cloud-rendered',
    pass: isSummitWhite,
    detail: `summit rim peak pos=(${Math.round(pPeak.sx)}, ${Math.round(pPeak.sy)}) rgba(${pxPeak.join(',')}) expected #f1f5f9`,
  });

  // Verification 2: Background preserved at corner (20, 20)
  const pxBg = ctx.getImageData(Math.round(20 * dpr), Math.round(20 * dpr), 1, 1).data;
  const isBgDark = pxBg[0] < 20 && pxBg[1] < 25 && pxBg[2] < 40;

  emit({
    check: 'background-preserved',
    pass: isBgDark,
    detail: `background pos=(20, 20) rgba(${pxBg.join(',')}) expected #0a0f1d`,
  });

  // 3D Orbit rotate benchmark: 60 frames
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    cloud.rotateBy(0.015, Math.sin(i * 0.1) * 0.005);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Verification 3: Point cloud rotates synchronously with drag
  cloud.yaw = 1.0;
  cloud.pitch = 0.4;
  cloud.draw();

  const pRotated = cloud.project(0, -650, 820);
  const pxRotated = ctx.getImageData(Math.round(pRotated.sx * dpr), Math.round(pRotated.sy * dpr), 1, 1).data;
  const isRotatedWhite = pxRotated[0] > 180 && pxRotated[1] > 190 && pxRotated[2] > 200;

  emit({
    check: 'point-cloud-rotates',
    pass: isRotatedWhite,
    detail: `rotated peak pos=(${Math.round(pRotated.sx)}, ${Math.round(pRotated.sy)}) rgba(${pxRotated.join(',')})`,
  });

  emit({ done: true });
}

// Auto-run when imported
const cloudInstance = (window as unknown as { __map?: Forge3dPointCloud }).__map;
if (cloudInstance) {
  void run(cloudInstance, performance.now());
}
