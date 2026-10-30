import { emit } from '../../../harness/page/bench.ts';
import type { BouncingMarkerMap } from './marker.ts';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

export async function run(map: BouncingMarkerMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  map.setAnimating(false);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const isPin = (p: number[]) => p[0] > 190 && p[1] > 50 && p[1] < 120 && p[2] < 60;

  // Independent projection from the exposed camera.
  const expect = (lng: number, lat: number): [number, number] => {
    const scale = 256 * Math.pow(2, map.zoom);
    const [cx, cy] = map.center;
    return [
      canvas.clientWidth / 2 + ((lng + 180) / 360 - cx) * scale,
      canvas.clientHeight / 2 + (mercY(lat) - cy) * scale,
    ];
  };

  map.resetAnimation();

  // 1. At rest the pin's tip sits on [-96, 37.8].
  const [ax0, ay0] = map.getAnchorScreenPos();
  const [m0x, m0y] = map.getMarkerScreenPos();
  const pin0 = rgba(m0x, m0y - 28);
  emit({
    check: 'marker-starts-at-anchor',
    pass: map.getBouncePx() < 1e-9 && Math.abs(m0x - ax0) < 1e-9 && Math.abs(m0y - ay0) < 1e-9 && isPin(pin0),
    detail: `bounce ${map.getBouncePx().toFixed(3)} px, tip (${m0x.toFixed(1)},${m0y.toFixed(1)}), ${fmt(pin0)}`,
  });

  // 2. Half a bounce period later the pin is 26 px above the anchor.
  map.advance(350);
  const [ax1, ay1] = map.getAnchorScreenPos();
  const [m1x, m1y] = map.getMarkerScreenPos();
  const pin1 = rgba(m1x, m1y - 28);
  emit({
    check: 'marker-bounces-up',
    pass: Math.abs(ay1 - m1y - 26) < 0.2 && Math.abs(ax1 - m1x) < 0.2 && isPin(pin1),
    detail: `bounce ${map.getBouncePx().toFixed(2)} px, head ${fmt(pin1)}`,
  });

  // 3. One full period later it is back on the anchor.
  map.advance(350);
  const [m2x, m2y] = map.getMarkerScreenPos();
  emit({
    check: 'marker-returns-to-anchor',
    pass: map.getBouncePx() < 0.01 && Math.abs(m2x - ax1) < 0.01 && Math.abs(m2y - ay1) < 0.01,
    detail: `bounce ${map.getBouncePx().toFixed(4)} px after 700 ms`,
  });

  // 4. Panning moves the anchor and the pin together.
  map.panBy(50, 30);
  const [ax2, ay2] = map.getAnchorScreenPos();
  const [m3x, m3y] = map.getMarkerScreenPos();
  const pin3 = rgba(m3x, m3y - 28);
  emit({
    check: 'marker-follows-pan',
    pass: Math.round(ax2 - ax1) === 50 && Math.round(ay2 - ay1) === 30 &&
      Math.abs(m3x - ax2) < 0.01 && Math.abs(m3y - ay2) < 0.01 && isPin(pin3),
    detail: `anchor moved (${Math.round(ax2 - ax1)},${Math.round(ay2 - ay1)}) px, ${fmt(pin3)}`,
  });

  // 5. Zooming keeps the anchor at the projected coordinate.
  map.setZoom(4.5);
  const [ax3, ay3] = map.getAnchorScreenPos();
  const [ex3, ey3] = expect(-96.0, 37.8);
  const [m4x, m4y] = map.getMarkerScreenPos();
  emit({
    check: 'marker-anchors-on-zoom',
    pass: Math.abs(ax3 - ex3) < 1.5 && Math.abs(ay3 - ey3) < 1.5 &&
      Math.abs(m4x - ax3) < 0.01 && Math.abs(m4y - ay3) < 0.01 && isPin(rgba(m4x, m4y - 28)),
    detail: `zoom ${map.zoom}, anchor (${ax3.toFixed(1)},${ay3.toFixed(1)}) expected (${ex3.toFixed(1)},${ey3.toFixed(1)})`,
  });

  // 6. Wheel zoom keeps the anchor under the cursor fixed.
  map.zoomAtPoint(ax3, ay3, 4.75);
  const [wx, wy] = map.getAnchorScreenPos();
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 4.75 && Math.abs(wx - ax3) < 1.5 && Math.abs(wy - ay3) < 1.5,
    detail: `zoom ${map.zoom}, anchor moved (${(wx - ax3).toFixed(2)}, ${(wy - ay3).toFixed(2)}) px`,
  });

  // 7. Cost of animating: 60 advance+draw frames and their pacing.
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();

  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.advance(16.7);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Leave the pin mid-hop for the screenshot.
  map.resetAnimation();
  map.advance(350);

  emit({ done: true });
}
