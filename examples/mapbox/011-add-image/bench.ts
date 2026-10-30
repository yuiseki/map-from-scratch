import { emit } from '../../../harness/page/bench.ts';
import type { ImageOverlayMap } from './image-overlay.ts';

const WEST = -80.425;
const EAST = -71.516;
const NORTH = 46.437;
const SOUTH = 37.936;

const CELLS: { fx: number; fy: number; rgb: [number, number, number]; name: string }[] = [
  { fx: 0.25, fy: 0.25, rgb: [46, 204, 113], name: 'green NW' },
  { fx: 0.75, fy: 0.25, rgb: [241, 196, 15], name: 'yellow NE' },
  { fx: 0.25, fy: 0.75, rgb: [230, 126, 34], name: 'orange SW' },
  { fx: 0.75, fy: 0.75, rgb: [231, 76, 60], name: 'red SE' },
];
const BACKGROUND = [22, 38, 60];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

async function waitForBase(map: ImageOverlayMap, want: number, ms = 15000): Promise<number> {
  const until = performance.now() + ms;
  while (map.baseReady() < want && performance.now() < until) await sleep(50);
  return map.baseReady();
}

function distinctColours(map: ImageOverlayMap, step = 4): number {
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

export async function run(map: ImageOverlayMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): number[] =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p.join(',')})`;
  const is = (p: number[], rgb: number[]) =>
    p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2];
  const isLand = (p: number[]) => p[0] > 225 && p[1] > 225 && p[2] > 210;

  const w = canvas.clientWidth, h = canvas.clientHeight;
  const project = (mx: number, my: number): [number, number] => {
    const scale = 256 * Math.pow(2, map.zoom);
    const [cx, cy] = map.center;
    return [w / 2 + (mx - cx) * scale, h / 2 + (my - cy) * scale];
  };

  const minX = mercX(WEST), maxX = mercX(EAST);
  const minY = mercY(NORTH), maxY = mercY(SOUTH);
  const imagePoint = (fx: number, fy: number): [number, number] =>
    project(minX + (maxX - minX) * fx, minY + (maxY - minY) * fy);
  const cellAt = (fx: number, fy: number): number[] => {
    const [x, y] = imagePoint(fx, fy);
    return pixelAt(x, y);
  };

  // 0. Real base map under the overlay, not a flat fill.
  for (let t = 0; t < 300 && !map.baseLoaded(); t++) await sleep(50);
  const visible = map.baseVisible();
  const ready = await waitForBase(map, visible);
  const colours = distinctColours(map);
  emit({
    check: 'basemap-drawn',
    pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
    detail: `${ready}/${visible} tiles ready, ${colours} distinct colours`,
  });

  // Exact-colour checks run without the base so a map pixel cannot pass for
  // an overlay pixel (and vice versa).
  map.setBaseVisible(false);
  map.draw();

  emit({
    check: 'image-loaded',
    pass: map.imageLoaded(),
    detail: `imageLoaded=${map.imageLoaded()}`,
  });

  // 1. Four solid cells sit at 25%/75% of the image in both axes. A flipped
  // or transposed placement swaps them and fails.
  const cells = CELLS.map((c) => ({ ...c, px: cellAt(c.fx, c.fy) }));
  emit({
    check: 'image-cells-in-place',
    pass: cells.every((c) => is(c.px, c.rgb)),
    detail: cells.map((c) => `${c.name} ${fmt(c.px)}`).join(', '),
  });

  // 2. The image stops exactly at its west edge: inside is the image
  // background, 12 px further west is bare land.
  const inside = imagePoint(0.02, 0.5);
  const outside = pixelAt(inside[0] - 12, inside[1]);
  const insidePx = pixelAt(inside[0] + 4, inside[1]);
  emit({
    check: 'image-clipped-to-bounds',
    pass: is(insidePx, BACKGROUND) && isLand(outside),
    detail: `inside 4 px ${fmt(insidePx)}, outside 12 px ${fmt(outside)}`,
  });

  // 3. Panning shifts the image with the map by exactly the pan delta.
  const before = cells.map((c) => imagePoint(c.fx, c.fy));
  map.panBy(150, 60);
  const after = cells.map((c) => imagePoint(c.fx, c.fy));
  const movedOk = before.every((b, i) =>
    Math.round(after[i][0] - b[0]) === 150 && Math.round(after[i][1] - b[1]) === 60);
  const greenAfter = cellAt(0.25, 0.25);
  const oldGreen = pixelAt(before[0][0], before[0][1]);
  emit({
    check: 'image-follows-pan',
    pass: movedOk && is(greenAfter, CELLS[0].rgb) && isLand(oldGreen),
    detail: `green moved to (${after[0][0].toFixed(1)},${after[0][1].toFixed(1)}), ${fmt(greenAfter)}; old spot ${fmt(oldGreen)}`,
  });

  // 4. Zooming about the image centre doubles the quad and keeps the cells.
  const mid = project((minX + maxX) / 2, (minY + maxY) / 2);
  const widthBefore = after[1][0] - after[0][0];
  map.zoomAtPoint(mid[0], mid[1], 6);
  const widthAfter = imagePoint(0.75, 0.25)[0] - imagePoint(0.25, 0.25)[0];
  const cellsAfter = CELLS.map((c) => ({ ...c, px: cellAt(c.fx, c.fy) }));
  emit({
    check: 'image-anchors-on-zoom',
    pass: map.zoom === 6 &&
      Math.abs(widthAfter - widthBefore * 2) < 1.5 &&
      cellsAfter.every((c) => is(c.px, c.rgb)),
    detail: `zoom ${map.zoom}, half-span ${widthBefore.toFixed(1)} -> ${widthAfter.toFixed(1)} px, ` +
      cellsAfter.map((c) => fmt(c.px)).join(', '),
  });

  // 5. Pan cost and frame pacing with the base and the image drawn.
  map.setBaseVisible(true);
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

  map.resetView();
  await waitForBase(map, map.baseVisible());

  emit({ done: true });
}
