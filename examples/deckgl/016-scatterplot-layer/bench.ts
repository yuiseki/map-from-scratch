import { emit } from '../../../harness/page/bench.ts';
import type { ScatterMap } from './map.ts';

// First point of the deck.gl-data Manhattan file: [-73.986022, 40.730743, 2].
const FIRST: [number, number] = [-73.986022, 40.730743];

export async function run(map: ScatterMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  const isHeavyDot = (px: Uint8ClampedArray): boolean => px[0] > 200 && px[1] > 120 && px[2] < 110;

  emit({
    check: 'all-points-loaded',
    pass: map.pointCount === 13987,
    detail: `pointCount=${map.pointCount}`,
  });

  // Verification 1: a weight-2 point is drawn with the high colour.
  const [x0, y0] = map.getScreenPos(FIRST[0], FIRST[1]);
  const dot = pixelAt(x0, y0);
  emit({
    check: 'points-visible',
    pass: isHeavyDot(dot),
    detail: `rgba(${dot.join(',')}) at first point`,
  });

  // Verification 2: pan moves the points with the map.
  map.panBy(40, 20);
  const [x1, y1] = map.getScreenPos(FIRST[0], FIRST[1]);
  const moved = pixelAt(x1, y1);
  emit({
    check: 'pan-moves-points',
    pass: Math.round(x1 - x0) === 40 && Math.round(y1 - y0) === 20 && isHeavyDot(moved),
    detail: `dx=${Math.round(x1 - x0)}, dy=${Math.round(y1 - y0)}, rgba(${moved.join(',')})`,
  });

  // Verification 3: zooming re-projects the points without losing them.
  map.setZoom(13);
  const [x2, y2] = map.getScreenPos(FIRST[0], FIRST[1]);
  const zoomed = pixelAt(x2, y2);
  emit({
    check: 'zoom-keeps-points',
    pass: isHeavyDot(zoomed),
    detail: `rgba(${zoomed.join(',')}) at zoom 13`,
  });

  map.setZoom(12);
  map.panBy(-40, -20);

  // Pan performance over 60 frames with all 13,987 points.
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 3);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }
  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  emit({ done: true });
}
