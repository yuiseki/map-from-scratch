import { emit } from '../../../harness/page/bench.ts';
import { STYLES } from './tiles.ts';
import type { RasterTileMap } from './tiles.ts';

export async function run(map: RasterTileMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await map.loadView();
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const BG = [233, 238, 242];

  const px = (x: number, y: number): number[] => {
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
  const isBg = (p: number[]): boolean => p[0] === BG[0] && p[1] === BG[1] && p[2] === BG[2];

  const tj = map.tileJson;
  emit({
    check: 'tilejson-loaded',
    pass: !!tj && tj.tileSize === 512 && tj.tiles.length > 0 && map.styleUrl === STYLES[0].url,
    detail: `${tj?.name ?? 'none'}, ${tj?.tileSize ?? 0}px tiles, z${tj?.minzoom}-${tj?.maxzoom}`,
  });

  // 1. No background colour anywhere on a grid: every part of the view is
  // covered by a decoded tile (or its ancestor).
  let bgHits = 0;
  let total = 0;
  for (let i = 1; i <= 8; i++) {
    for (let j = 1; j <= 6; j++) {
      total++;
      if (isBg(px((w * i) / 9, (h * j) / 7))) bgHits++;
    }
  }
  emit({
    check: 'tiles-cover-viewport',
    pass: bgHits === 0,
    detail: `${bgHits}/${total} background samples at z${map.zoom.toFixed(1)}, tile z${Math.round(map.zoom)}`,
  });

  // 2. No background along the shared edges between neighbouring tiles.
  const edges = map.tileEdges();
  let seamHits = 0;
  let seamSamples = 0;
  for (const ex of edges.xs) {
    if (ex < 3 || ex > w - 3) continue;
    for (let k = 1; k <= 5; k++) {
      seamSamples++;
      if (isBg(px(ex, (h * k) / 6))) seamHits++;
    }
  }
  for (const ey of edges.ys) {
    if (ey < 3 || ey > h - 3) continue;
    for (let k = 1; k <= 5; k++) {
      seamSamples++;
      if (isBg(px((w * k) / 6, ey))) seamHits++;
    }
  }
  emit({
    check: 'no-seams-between-tiles',
    pass: seamHits === 0 && seamSamples >= 10,
    detail: `${seamHits}/${seamSamples} background pixels on tile edges`,
  });

  // 3. An integer pan moves the picture by exactly that many pixels.
  const pts: [number, number][] = [
    [w * 0.3, h * 0.3],
    [w * 0.5, h * 0.45],
    [w * 0.7, h * 0.35],
    [w * 0.4, h * 0.65],
    [w * 0.6, h * 0.6],
    [w * 0.35, h * 0.5],
  ];
  const before = pts.map(([x, y]) => px(x, y).join(','));
  map.panBy(64, 48);
  const after = pts.map(([x, y]) => px(x + 64, y + 48).join(','));
  const same = before.filter((v, i) => v === after[i]).length;
  emit({
    check: 'pan-moves-tiles-exactly',
    pass: same === pts.length,
    detail: `${same}/${pts.length} samples identical after panBy(64, 48)`,
  });

  // 4. Wheel zoom keeps the point under the cursor fixed.
  const ax = w * 0.62;
  const ay = h * 0.4;
  const [mx, my] = map.worldAtScreen(ax, ay);
  map.zoomAtPoint(ax, ay, 5.6);
  const [nx, ny] = map.screenOfWorld(mx, my);
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: Math.abs(nx - ax) < 1.5 && Math.abs(ny - ay) < 1.5,
    detail: `z=${map.zoom}, anchor moved (${(nx - ax).toFixed(2)}, ${(ny - ay).toFixed(2)}) px`,
  });
  map.setZoom(5);
  await map.loadView();

  // 5. Switching TileJSON (a different tile URL and style) repaints the view.
  // A 16x12 grid rather than a handful of points: Carto and Bright agree on
  // much of the land, so sparse sampling saw almost no change.
  const grid: [number, number][] = [];
  for (let i = 1; i <= 16; i++) {
    for (let j = 1; j <= 12; j++) grid.push([(w * i) / 17, (h * j) / 13]);
  }
  const beforeStyle = grid.map(([x, y]) => px(x, y));
  await map.setStyle(STYLES[2].url);
  const afterStyle = grid.map(([x, y]) => px(x, y));
  let changed = 0;
  let diffSum = 0;
  for (let i = 0; i < grid.length; i++) {
    const p = beforeStyle[i];
    const q = afterStyle[i];
    const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
    diffSum += d;
    if (d > 12) changed++;
  }
  emit({
    check: 'style-switch-repaints',
    pass: changed >= grid.length * 0.2 && map.styleUrl === STYLES[2].url,
    detail: `${changed}/${grid.length} samples changed, mean max-channel diff ${(diffSum / grid.length).toFixed(1)} on ${map.tileJson?.name ?? '?'}`,
  });
  await map.setStyle(STYLES[0].url);

  // Pan cost and frame pacing with every visible tile already decoded.
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
