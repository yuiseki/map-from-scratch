import { emit } from '../../../harness/page/bench.ts';
import type { ScrollZoomMap } from './map.ts';

export async function run(map: ScrollZoomMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Center [Portland] is land, [-140, 45.52] is Pacific ocean
  const [centerX, centerY] = map.getScreenPos(-122.65, 45.52);
  const pxCenter = ctx.getImageData(Math.round(centerX * dpr), Math.round(centerY * dpr), 1, 1).data;
  const isLand = pxCenter[0] > 220 && pxCenter[1] > 220 && pxCenter[2] > 210;

  const [oceanX, oceanY] = map.getScreenPos(-140.0, 45.52);
  const pxOcean = ctx.getImageData(Math.round(oceanX * dpr), Math.round(oceanY * dpr), 1, 1).data;
  const isOcean = pxOcean[0] < 190 && pxOcean[1] > 190 && pxOcean[2] > 210;

  emit({
    check: 'map-rendered-at-target',
    pass: isLand && isOcean,
    detail: `land rgba(${pxCenter.join(',')}) at center, ocean rgba(${pxOcean.join(',')}) at [-140, 45.52]`,
  });

  // Verification 2: Scroll zoom blocked when disabled
  const initialZoom = map.zoom;
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  const zoomAfterScroll = map.zoom;
  const scrollBlocked = !map.scrollZoomEnabled && zoomAfterScroll === initialZoom;

  emit({
    check: 'scroll-zoom-blocked',
    pass: scrollBlocked,
    detail: `initialZoom=${initialZoom}, afterWheelZoom=${zoomAfterScroll}, scrollZoomEnabled=${map.scrollZoomEnabled}`,
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

  // Verification 3: Pan works normally
  map.setZoom(3);
  const [baseLandX, baseLandY] = map.getScreenPos(-122.65, 45.52);
  map.panBy(50, 30);
  const [pannedLandX, pannedLandY] = map.getScreenPos(-122.65, 45.52);
  const pxPanned = ctx.getImageData(Math.round(pannedLandX * dpr), Math.round(pannedLandY * dpr), 1, 1).data;
  const isPannedLand = pxPanned[0] > 220 && pxPanned[1] > 220 && pxPanned[2] > 210;

  emit({
    check: 'pan-works-normally',
    pass: isPannedLand && Math.round(pannedLandX - baseLandX) === 50 && Math.round(pannedLandY - baseLandY) === 30,
    detail: `dx=${Math.round(pannedLandX - baseLandX)}, dy=${Math.round(pannedLandY - baseLandY)}, rgba(${pxPanned.join(',')})`,
  });

  // Verification 4: Scroll zoom functions when enabled
  map.setScrollZoom(true);
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  const zoomAfterEnabledScroll = map.zoom;
  const scrollEnabledWorks = map.scrollZoomEnabled && zoomAfterEnabledScroll > 3;

  emit({
    check: 'scroll-zoom-toggleable',
    pass: scrollEnabledWorks,
    detail: `zoomAfterEnabledWheel=${zoomAfterEnabledScroll}`,
  });

  emit({ done: true });
}
