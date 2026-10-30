import { emit } from '../../../harness/page/bench.ts';
import type { AnimatePointMap } from './orbit.ts';

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;

export async function run(map: AnimatePointMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  // The page animates on its own; stop it so every check is deterministic.
  map.setAnimating(false);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const isDot = (p: number[]) => p[0] < 60 && p[1] > 90 && p[1] < 165 && p[2] > 150;

  // Independent screen projection from the exposed camera, not the renderer's helper.
  const expect = (lng: number, lat: number): [number, number] => {
    const scale = 256 * Math.pow(2, map.zoom);
    const [cx, cy] = map.center;
    return [
      canvas.clientWidth / 2 + ((lng + 180) / 360 - cx) * scale,
      canvas.clientHeight / 2 + (mercY(lat) - cy) * scale,
    ];
  };

  map.resetAngle();

  // 1. The point starts 20° east of [0, 0] and is drawn there.
  const [sx, sy] = map.getPointScreenPos();
  const [ex0, ey0] = expect(20, 0);
  const start = rgba(sx, sy);
  const [lng0, lat0] = map.getPointLngLat();
  emit({
    check: 'point-starts-east',
    pass: Math.abs(lng0 - 20) < 0.2 && Math.abs(lat0) < 0.2 &&
      Math.abs(sx - ex0) < 1.5 && Math.abs(sy - ey0) < 1.5 && isDot(start),
    detail: `lnglat=(${lng0.toFixed(2)},${lat0.toFixed(2)}) pos=(${sx.toFixed(1)},${sy.toFixed(1)}) expected=(${ex0.toFixed(1)},${ey0.toFixed(1)}) ${fmt(start)}`,
  });

  // 2. After 1.5 s at 60°/s the point has travelled a quarter turn, to 20° north.
  map.advance(1500);
  const [nx, ny] = map.getPointScreenPos();
  const [ex1, ey1] = expect(0, 20);
  const north = rgba(nx, ny);
  const [lng1, lat1] = map.getPointLngLat();
  const travelled = Math.hypot(nx - sx, ny - sy);
  emit({
    check: 'point-orbits-north',
    pass: Math.abs(lng1) < 0.2 && Math.abs(lat1 - 20) < 0.2 &&
      Math.abs(nx - ex1) < 1.5 && Math.abs(ny - ey1) < 1.5 && travelled > 200 && isDot(north),
    detail: `lnglat=(${lng1.toFixed(2)},${lat1.toFixed(2)}) moved ${travelled.toFixed(1)} px, ${fmt(north)}`,
  });

  // 3. The point moves with the map by exactly the pan offset.
  map.panBy(50, 30);
  const [px, py] = map.getPointScreenPos();
  const panned = rgba(px, py);
  emit({
    check: 'point-moves-with-pan',
    pass: Math.round(px - nx) === 50 && Math.round(py - ny) === 30 && isDot(panned),
    detail: `dx=${Math.round(px - nx)}, dy=${Math.round(py - ny)}, ${fmt(panned)}`,
  });

  // 4. Zooming keeps the dot on the projected orbit position.
  map.setZoom(4.5);
  const [zx, zy] = map.getPointScreenPos();
  const [ex2, ey2] = expect(lng1, lat1);
  const zoomed = rgba(zx, zy);
  emit({
    check: 'point-anchors-on-zoom',
    pass: Math.abs(zx - ex2) < 1.5 && Math.abs(zy - ey2) < 1.5 && isDot(zoomed),
    detail: `zoom=${map.zoom} pos=(${zx.toFixed(1)},${zy.toFixed(1)}) expected=(${ex2.toFixed(1)},${ey2.toFixed(1)}) ${fmt(zoomed)}`,
  });

  // 5. Wheel zoom keeps the point under the cursor fixed.
  map.zoomAtPoint(zx, zy, 4.75);
  const [wx, wy] = map.getPointScreenPos();
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: Math.abs(wx - zx) < 1.5 && Math.abs(wy - zy) < 1.5,
    detail: `zoom ${map.zoom}, point moved (${(wx - zx).toFixed(2)}, ${(wy - zy).toFixed(2)}) px`,
  });

  // 6. Cost of animating: 60 advance+draw frames and their pacing.
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

  emit({ done: true });
}
