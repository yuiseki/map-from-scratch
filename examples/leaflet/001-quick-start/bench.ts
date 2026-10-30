import { emit } from '../../../harness/page/bench.ts';
import type { QuickStartMap } from './map.ts';

export async function run(map: QuickStartMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // 1. Verification: Marker is visible at London position
  const [mx, my] = map.getScreenPos(51.5, -0.09);
  const pxMarker = ctx.getImageData(Math.round(mx * dpr), Math.round((my - 20) * dpr), 1, 1).data;
  const isBlue = pxMarker[0] < 80 && pxMarker[1] > 90 && pxMarker[2] > 160;
  emit({
    check: 'marker-visible',
    pass: isBlue,
    detail: `rgba(${pxMarker[0]},${pxMarker[1]},${pxMarker[2]},${pxMarker[3]}) at marker (${Math.round(mx)},${Math.round(my - 20)})`,
  });

  // 2. Verification: Circle is visible with red tint
  const [cx, cy] = map.getScreenPos(51.508, -0.11);
  const pxCircle = ctx.getImageData(Math.round(cx * dpr), Math.round(cy * dpr), 1, 1).data;
  const isRed = pxCircle[0] > 180 && pxCircle[1] < 150 && pxCircle[2] < 150;
  emit({
    check: 'circle-visible',
    pass: isRed,
    detail: `rgba(${pxCircle[0]},${pxCircle[1]},${pxCircle[2]},${pxCircle[3]}) at circle (${Math.round(cx)},${Math.round(cy)})`,
  });

  // 3. Verification: Click circle opens circle popup
  map.clickAtScreen(cx, cy);
  const circlePopupPass = map.activePopup?.text === 'I am a circle.';
  emit({
    check: 'click-circle-shows-popup',
    pass: circlePopupPass,
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  // 4. Verification: Click polygon opens polygon popup
  const [px, py] = map.getScreenPos(51.507, -0.065);
  map.clickAtScreen(px, py);
  const polyPopupPass = map.activePopup?.text === 'I am a polygon.';
  emit({
    check: 'click-polygon-shows-popup',
    pass: polyPopupPass,
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  // 5. Verification: Click marker opens marker popup
  map.clickAtScreen(mx, my - 20);
  const markerPopupPass = map.activePopup?.text === 'Hello world! I am a popup.';
  emit({
    check: 'click-marker-shows-popup',
    pass: markerPopupPass,
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  // Measure pan frame interval and redraw cost
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(Math.sin(i * 0.1) * 2, Math.cos(i * 0.1) * 2);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  emit({ done: true });
}
