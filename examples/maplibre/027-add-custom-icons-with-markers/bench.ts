import { emit } from '../../../harness/page/bench.ts';
import type { CustomIconsMap } from './icons.ts';

const COLORS = [
  { name: 'green', rgb: [27, 138, 58] },
  { name: 'orange', rgb: [232, 89, 12] },
  { name: 'magenta', rgb: [179, 18, 92] },
];

export async function run(map: CustomIconsMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Wait for every OSM Carto tile covering this view (20 at z10).
  const waitStart = performance.now();
  while (performance.now() - waitStart < 15000) {
    if (map.baseComplete()) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  // Sample the pin head, offset 8 px right of its centre to miss the white dot.
  const head = (index: number) => {
    const [x, y] = map.getMarkerScreenPos(index);
    return rgba(x + 8, y - 32);
  };
  const matches = (p: number[], rgb: number[]) =>
    Math.abs(p[0] - rgb[0]) <= 10 && Math.abs(p[1] - rgb[1]) <= 10 && Math.abs(p[2] - rgb[2]) <= 10;

  // 0. The raster base map is really on screen: count distinct colours.
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const colours = new Set<number>();
  for (let y = 0; y < canvas.height; y += 8 * dpr) {
    for (let x = 0; x < canvas.width; x += 8 * dpr) {
      const i = (y * canvas.width + x) * 4;
      colours.add((frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2]);
    }
  }
  emit({
    check: 'basemap-drawn',
    pass: map.baseComplete() && colours.size > 200,
    detail: `${map.baseReady()} tiles ready, ${colours.size} distinct colours`,
  });

  // 1. All three custom pins are drawn with their own colour.
  const seen = COLORS.map((c, i) => matches(head(i), c.rgb));
  emit({
    check: 'custom-icons-visible',
    pass: seen.every(Boolean),
    detail: COLORS.map((c, i) => `${c.name}: ${fmt(head(i))}`).join(' / '),
  });

  // 2. Pan cost and frame pacing.
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

  // 3. Every pin moves with the map by the same screen offset.
  map.setZoom(10);
  const before = [0, 1, 2].map((i) => map.getMarkerScreenPos(i));
  map.panBy(40, 25);
  const after = [0, 1, 2].map((i) => map.getMarkerScreenPos(i));
  const shifted = before.every((b, i) =>
    Math.round(after[i][0] - b[0]) === 40 && Math.round(after[i][1] - b[1]) === 25);
  emit({
    check: 'markers-move-with-pan',
    pass: shifted && seen.every(Boolean),
    detail: `dx=${Math.round(after[0][0] - before[0][0])}, dy=${Math.round(after[0][1] - before[0][1])} for ${map.markerCount} pins`,
  });

  // 4. The pins keep their geographic spacing: doubling the zoom doubles it on screen.
  const dist = () => {
    const [ax, ay] = map.getMarkerScreenPos(0);
    const [bx, by] = map.getMarkerScreenPos(1);
    return Math.hypot(bx - ax, by - ay);
  };
  const d10 = dist();
  map.setZoom(11);
  const d11 = dist();
  emit({
    check: 'marker-spacing-scales',
    pass: Math.abs(d11 / d10 - 2) < 0.05,
    detail: `${d10.toFixed(2)} px at z10 -> ${d11.toFixed(2)} px at z11 (ratio ${(d11 / d10).toFixed(3)})`,
  });

  // 5. All pins are still drawn after the zoom, at their new positions.
  emit({
    check: 'markers-anchor-on-zoom',
    pass: COLORS.every((c, i) => matches(head(i), c.rgb)),
    detail: COLORS.map((c, i) => `${c.name}: ${fmt(head(i))}`).join(' / '),
  });

  // 6. Wheel zoom keeps the point under the cursor fixed.
  const [ax, ay] = map.getMarkerScreenPos(0);
  map.zoomAtPoint(ax, ay, 12);
  const [wx, wy] = map.getMarkerScreenPos(0);
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 12 && Math.abs(wx - ax) < 1.5 && Math.abs(wy - ay) < 1.5,
    detail: `zoom ${map.zoom}, marker 0 moved (${(wx - ax).toFixed(2)}, ${(wy - ay).toFixed(2)}) px`,
  });

  // Leave the page at the default view with the base tiles in place.
  map.resetView();
  const settle = performance.now();
  while (performance.now() - settle < 5000 && !map.baseComplete()) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise(requestAnimationFrame);

  emit({ done: true });
}
