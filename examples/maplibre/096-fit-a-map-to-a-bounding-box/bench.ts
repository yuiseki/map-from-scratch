import { emit } from '../../../harness/page/bench.ts';
import type { FitBoundsMap } from './fit.ts';

const BOUNDS: [[number, number], [number, number]] = [
  [32.958984, -5.353521],
  [43.50585, 5.615985],
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

async function waitForBase(map: FitBoundsMap, want: number, ms = 20000): Promise<number> {
  const until = performance.now() + ms;
  while (map.baseReady() < want && performance.now() < until) await sleep(50);
  return map.baseReady();
}

function distinctColours(map: FitBoundsMap, step = 4): number {
  const { ctx, canvas } = map;
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const seen = new Set<number>();
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  return seen.size;
}

export async function run(map: FitBoundsMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): number[] =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p.join(',')})`;
  const isCornerDot = (p: number[]) => p[0] === 230 && p[1] === 57 && p[2] === 70;
  const isCentreDot = (p: number[]) => p[0] === 30 && p[1] === 111 && p[2] === 217;

  const w = canvas.clientWidth, h = canvas.clientHeight;
  const project = (mx: number, my: number): [number, number] => {
    const scale = 256 * Math.pow(2, map.zoom);
    const [cx, cy] = map.center;
    return [w / 2 + (mx - cx) * scale, h / 2 + (my - cy) * scale];
  };

  const west = BOUNDS[0][0], south = BOUNDS[0][1];
  const east = BOUNDS[1][0], north = BOUNDS[1][1];
  const minX = mercX(west), maxX = mercX(east);
  const minY = mercY(north), maxY = mercY(south);
  const expScale = Math.min(w / (maxX - minX), h / (maxY - minY));
  const expZoom = Math.log2(expScale / 256);
  const expCx = (minX + maxX) / 2, expCy = (minY + maxY) / 2;

  // 0. The opening view (New York at zoom 9) needs a real base map.
  for (let t = 0; t < 300 && !map.baseLoaded(); t++) await sleep(50);
  const visible0 = map.baseVisible();
  const ready0 = await waitForBase(map, visible0);
  const colours0 = distinctColours(map);
  emit({
    check: 'basemap-drawn',
    pass: map.baseLoaded() && visible0 >= 2 && ready0 === visible0 && colours0 > 150,
    detail: `${ready0}/${visible0} tiles ready, ${colours0} distinct colours`,
  });

  // 1. Before the button, the camera is the New York view from the example.
  emit({
    check: 'initial-view-is-new-york',
    pass: map.zoom === 9 &&
      Math.abs(map.center[0] - mercX(-74.5)) < 1e-9 &&
      Math.abs(map.center[1] - mercY(40)) < 1e-9,
    detail: `zoom ${map.zoom}, centre [${map.center.map((v) => v.toFixed(6)).join(',')}]`,
  });

  // 2. Clicking the button fits the box: centre is the mercator midpoint and
  // the zoom is the larger of the two axis scales, as cameraForBounds does.
  document.getElementById('fit')?.click();
  emit({
    check: 'fit-sets-camera',
    pass: Math.abs(map.zoom - expZoom) < 0.005 &&
      Math.abs(map.center[0] - expCx) < 1e-9 &&
      Math.abs(map.center[1] - expCy) < 1e-9,
    detail: `zoom ${map.zoom.toFixed(4)} vs ${expZoom.toFixed(4)}, centre [${map.center.map((v) => v.toFixed(6)).join(',')}]`,
  });

  // 3. The independent projection of the four bounds corners: one axis must
  // be flush with the viewport and both margins symmetric.
  const nw = project(minX, minY);
  const ne = project(maxX, minY);
  const sw = project(minX, maxY);
  const se = project(maxX, maxY);
  const left = nw[0], right = w - ne[0], top = nw[1], bottom = h - se[1];
  emit({
    check: 'fit-bounds-flush',
    pass: Math.min(Math.abs(left), Math.abs(top)) < 1.5 &&
      Math.abs(left - right) < 1.5 && Math.abs(top - bottom) < 1.5 &&
      left > -0.5 && top > -0.5,
    detail: `margins L ${left.toFixed(1)}, R ${right.toFixed(1)}, T ${top.toFixed(1)}, B ${bottom.toFixed(1)}`,
  });

  // 4. Corner dots sit on the projected corners and the centre dot on the
  // bbox centre; sampled inside the dots for exact RGB.
  const nwPx = pixelAt(nw[0], 3);
  const nePx = pixelAt(ne[0], 3);
  const swPx = pixelAt(sw[0], h - 3);
  const sePx = pixelAt(se[0], h - 3);
  const midPx = pixelAt(w / 2, h / 2);
  emit({
    check: 'fit-corner-markers-drawn',
    pass: isCornerDot(nwPx) && isCornerDot(nePx) && isCornerDot(swPx) &&
      isCornerDot(sePx) && isCentreDot(midPx),
    detail: `NW ${fmt(nwPx)}, NE ${fmt(nePx)}, SW ${fmt(swPx)}, SE ${fmt(sePx)}, centre ${fmt(midPx)}`,
  });

  // 5. Panning shifts the bounds by exactly the pan delta.
  map.panBy(80, 50);
  const nw2 = project(minX, minY);
  const moved = pixelAt(nw2[0], nw2[1] + 3);
  const oldSpot = pixelAt(nw[0], 3);
  emit({
    check: 'pan-moves-bounds',
    pass: Math.round(nw2[0] - nw[0]) === 80 && Math.round(nw2[1] - nw[1]) === 50 &&
      isCornerDot(moved) && !isCornerDot(oldSpot),
    detail: `NW moved (${(nw2[0] - nw[0]).toFixed(1)},${(nw2[1] - nw[1]).toFixed(1)}), old ${fmt(oldSpot)}, new ${fmt(moved)}`,
  });

  // 6. Zooming about the bounds centre doubles every corner offset.
  const mid2 = project((minX + maxX) / 2, (minY + maxY) / 2);
  map.zoomAtPoint(mid2[0], mid2[1], expZoom + 1);
  const nw3 = project(minX, minY);
  const expectNwX = mid2[0] + (nw2[0] - mid2[0]) * 2;
  const expectNwY = mid2[1] + (nw2[1] - mid2[1]) * 2;
  const mid3 = pixelAt(mid2[0], mid2[1]);
  emit({
    check: 'zoom-keeps-bounds',
    pass: Math.abs(map.zoom - (expZoom + 1)) < 0.005 &&
      Math.abs(nw3[0] - expectNwX) < 1.5 && Math.abs(nw3[1] - expectNwY) < 1.5 &&
      isCentreDot(mid3),
    detail: `zoom ${map.zoom.toFixed(4)}, NW (${nw3[0].toFixed(1)},${nw3[1].toFixed(1)}) expected (${expectNwX.toFixed(1)},${expectNwY.toFixed(1)}), centre ${fmt(mid3)}`,
  });

  // 7. Pan cost and frame pacing on the opening view with the base loaded.
  map.resetView();
  await waitForBase(map, map.baseVisible());
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

  // Leave the screenshot on the fitted view with its base map loaded.
  document.getElementById('fit')?.click();
  await waitForBase(map, map.baseVisible());

  emit({ done: true });
}
