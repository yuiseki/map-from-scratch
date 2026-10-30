import { emit } from '../../../harness/page/bench.ts';
import type { CirclesMap } from './map.ts';

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

export async function run(map: CirclesMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  const tintAt = (lon: number, lat: number, dx = 0, dy = 0): Uint8ClampedArray => {
    const [x, y] = map.screenFromMercator(mercX(lon), mercY(lat));
    return pixelAt(x + dx, y + dy);
  };
  const rgba = (px: Uint8ClampedArray): string => `rgba(${px[0]},${px[1]},${px[2]})`;

  const radii = map.circles.map((c) => `${c.name}:${c.radiusM}`).join(',');
  emit({
    check: 'circles-loaded',
    pass:
      map.circles.length === 3 &&
      map.circles.every((c) => c.ring.length === 129) &&
      map.circles[0].radiusM === 1500000 &&
      map.circles[1].radiusM === 1200000 &&
      map.circles[2].radiusM === 1000000,
    detail: radii,
  });

  // Probe half a radius to the left of each centre, away from the label.
  const tokyoR = map.circleRadiusPx('Tokyo');
  const tokyo = tintAt(139.69, 35.69, -tokyoR / 2, 0);
  emit({
    check: 'tokyo-circle-fill',
    // Over the Sea of Japan (ocean g about 18) the cyan tint reads g 55 to 60
    // depending on the GPU's blending: g > 45 is the tint, not the ocean.
    pass: tokyo[2] > 75 && tokyo[2] - tokyo[0] > 50 && tokyo[1] > 45,
    detail: `${rgba(tokyo)} at 0.5R, R=${tokyoR.toFixed(1)}px`,
  });

  const nyR = map.circleRadiusPx('New York');
  const ny = tintAt(-74.0, 40.71, -nyR / 2, 0);
  emit({
    check: 'new-york-circle-fill',
    pass: ny[0] > 55 && ny[0] - ny[2] > 35 && ny[1] > 40,
    detail: `${rgba(ny)} at 0.5R, R=${nyR.toFixed(1)}px`,
  });

  const londonR = map.circleRadiusPx('London');
  const london = tintAt(-0.13, 51.51, -londonR / 2, 0);
  emit({
    check: 'london-circle-fill',
    pass: london[2] > 70 && london[2] - london[1] > 25 && london[0] > 35,
    detail: `${rgba(london)} at 0.5R, R=${londonR.toFixed(1)}px`,
  });

  // Horizontal radii at zoom 2: Tokyo 47.2 px, New York 40.4 px, London 41.0 px.
  emit({
    check: 'radius-kept',
    pass:
      Math.abs(tokyoR - 47.2) < 2.5 &&
      Math.abs(nyR - 40.4) < 2.5 &&
      Math.abs(londonR - 41.0) < 2.5,
    detail: `R Tokyo=${tokyoR.toFixed(1)} NY=${nyR.toFixed(1)} London=${londonR.toFixed(1)}`,
  });

  const [tx0, ty0] = map.screenFromMercator(mercX(139.69), mercY(35.69));
  map.panBy(40, 20);
  const [tx1, ty1] = map.screenFromMercator(mercX(139.69), mercY(35.69));
  const panR = map.circleRadiusPx('Tokyo');
  const panned = tintAt(139.69, 35.69, -panR / 2, 0);
  emit({
    check: 'pan-moves-circles',
    pass:
      Math.round(tx1 - tx0) === 40 &&
      Math.round(ty1 - ty0) === 20 &&
      panned[2] > 75 &&
      panned[2] - panned[0] > 50,
    detail: `dx=${Math.round(tx1 - tx0)}, dy=${Math.round(ty1 - ty0)}, ${rgba(panned)}`,
  });
  map.panBy(-40, -20);

  // Wheel zoom must keep the place under the pointer, not the screen centre.
  const [wx, wy] = map.screenFromMercator(mercX(139.69), mercY(35.69));
  map.zoomAt(3, wx, wy);
  const [wx2, wy2] = map.screenFromMercator(mercX(139.69), mercY(35.69));
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 3 && Math.abs(wx2 - wx) < 1.5 && Math.abs(wy2 - wy) < 1.5,
    detail: `Tokyo at (${wx.toFixed(1)}, ${wy.toFixed(1)}) before, (${wx2.toFixed(1)}, ${wy2.toFixed(1)}) after zoom 3`,
  });
  map.setZoom(2);

  map.setCenter(139.69, 35.69);
  map.setZoom(3);
  const zoomR = map.circleRadiusPx('Tokyo');
  const zoomed = tintAt(139.69, 35.69, -zoomR / 2, 0);
  emit({
    check: 'zoom-keeps-circles',
    pass: zoomR > tokyoR * 1.8 && zoomR < tokyoR * 2.2 && zoomed[2] - zoomed[0] > 50 && zoomed[2] > 75,
    detail: `R=${zoomR.toFixed(1)}px at zoom 3, ${rgba(zoomed)}`,
  });
  map.setZoom(2);
  map.setCenter(0, 25);

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
