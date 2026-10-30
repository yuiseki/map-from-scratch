import { emit } from '../../../harness/page/bench.ts';
import type { GeoJsonMap } from './map.ts';

export async function run(map: GeoJsonMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  const isBlueDot = (px: Uint8ClampedArray): boolean => px[2] > 150 && px[2] - px[0] > 80;
  const isOrangeLine = (px: Uint8ClampedArray): boolean => px[0] > 200 && px[1] > 80 && px[1] < 190 && px[2] < 100;
  const isBlueFill = (px: Uint8ClampedArray): boolean => px[2] - px[0] > 12 && px[2] > 190;

  // Verification 1: the London point marker is drawn as a blue circle.
  const [lx, ly] = map.getScreenPos(51.5074, -0.1278);
  const london = pixelAt(lx, ly);
  emit({
    check: 'point-marker-visible',
    pass: isBlueDot(london),
    detail: `London marker rgba(${london.join(',')})`,
  });

  // Verification 2: the London-Paris route is an orange line; sample the
  // midpoint of the screen-space segment.
  const [ax, ay] = map.getScreenPos(51.5074, -0.1278);
  const [bx, by] = map.getScreenPos(48.8566, 2.3522);
  const route = pixelAt((ax + bx) / 2, (ay + by) / 2);
  emit({
    check: 'route-line-visible',
    pass: isOrangeLine(route),
    detail: `route midpoint rgba(${route.join(',')})`,
  });

  // Verification 3: the Europe polygon tints the land near 6 E 52 N.
  const [px_, py_] = map.getScreenPos(52, 6);
  const fill = pixelAt(px_, py_);
  emit({
    check: 'polygon-fill-visible',
    pass: isBlueFill(fill),
    detail: `polygon interior rgba(${fill.join(',')})`,
  });

  // Verification 4: clicking a point shows its property as a popup.
  map.clickAtScreen(lx, ly);
  emit({
    check: 'click-point-shows-popup',
    pass: map.activePopup?.text === 'London',
    detail: `popup=${JSON.stringify(map.activePopup)}`,
  });

  // Verification 5: clicking inside the polygon shows the region name. The
  // point click above had no hit test effect on the polygon.
  const [cx, cy] = map.getScreenPos(52, 6);
  map.clickAtScreen(cx, cy);
  emit({
    check: 'click-polygon-shows-popup',
    pass: map.activePopup?.text === 'Central Europe',
    detail: `popup=${JSON.stringify(map.activePopup)}`,
  });

  // Verification 6: a pan moves the features with the map.
  map.clickAtScreen(-100, -100); // clear popup off-screen (no hit)
  map.panBy(40, 20);
  const [mx, my] = map.getScreenPos(51.5074, -0.1278);
  const moved = pixelAt(mx, my);
  emit({
    check: 'pan-keeps-features',
    pass: Math.round(mx - lx) === 40 && Math.round(my - ly) === 20 && isBlueDot(moved),
    detail: `dx=${Math.round(mx - lx)}, dy=${Math.round(my - ly)}, rgba(${moved.join(',')})`,
  });

  // Pan performance over 60 frames.
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
