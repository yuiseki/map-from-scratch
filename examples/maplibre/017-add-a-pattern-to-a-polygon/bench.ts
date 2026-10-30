import { emit } from '../../../harness/page/bench.ts';
import type { PatternFillMap } from './pattern.ts';

export async function run(map: PatternFillMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;

  // 0. A regional view needs a real base map, not a flat land fill. Wait for
  // the raster tiles, then count distinct colours: a flat fill yields a
  // handful, OSM Carto yields dozens.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let t = 0; t < 300 && !map.baseLoaded(); t++) await sleep(50);
  const visible = map.baseVisible();
  let ready = map.baseReady();
  const until = performance.now() + 15000;
  while (ready < visible && performance.now() < until) {
    await sleep(50);
    ready = map.baseReady();
  }
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4 * 4) {
    seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  emit({
    check: 'basemap-drawn',
    pass: map.baseLoaded() && visible >= 2 && ready === visible && seen.size > 40,
    detail: `${ready}/${visible} tiles ready, ${seen.size} distinct colours`,
  });
  const A = [246, 224, 94];
  const B = [43, 108, 176];
  const near = (p: number[], rgb: number[], tol = 20) =>
    Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;
  const isPattern = (p: number[]) => near(p, A) || near(p, B);

  // 1. Both checker colours cover the polygon interior.
  let countA = 0;
  let countB = 0;
  for (let y = 311; y <= 351; y += 2) {
    for (let x = 401; x <= 441; x += 2) {
      const p = rgba(x, y);
      if (near(p, A)) countA++;
      else if (near(p, B)) countB++;
    }
  }
  emit({
    check: 'pattern-fill-visible',
    pass: countA > 50 && countB > 50,
    detail: `${countA} yellow and ${countB} blue samples in a 21x21 grid`,
  });

  // 2. The 12 px checker repeats every 24 px and swaps at 12 px.
  const a = rgba(421, 331);
  const b = rgba(433, 331);
  const c = rgba(445, 331);
  const d = rgba(421, 343);
  emit({
    check: 'pattern-is-periodic',
    pass: a[0] === c[0] && a[1] === c[1] && a[2] === c[2] &&
      !(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) &&
      !(a[0] === d[0] && a[1] === d[1] && a[2] === d[2]),
    detail: `${fmt(a)} / ${fmt(b)} / ${fmt(c)} / ${fmt(d)} at +0, +12, +24, +12y`,
  });

  // 3. The fill follows the polygon when the map pans; the pattern itself is
  // anchored to the canvas, so sampling stays inside the moved edges.
  const [lx0] = map.getScreenPos(-109, 39);
  map.panBy(24, 6);
  const [lx1, ty1] = map.getScreenPos(-109, 39);
  const inside = rgba(lx1 + 6, ty1 + 40);
  const outside = rgba(lx1 - 4, ty1 + 40);
  emit({
    check: 'pattern-follows-polygon-on-pan',
    pass: Math.round(lx1 - lx0) === 24 && isPattern(inside) && !isPattern(outside),
    detail: `left edge +${Math.round(lx1 - lx0)} px, inside ${fmt(inside)}, outside ${fmt(outside)}`,
  });

  // 4. The edges stay on the geographic box when zooming.
  map.setZoom(7);
  const [lx2, ty2] = map.getScreenPos(-109, 39);
  const insideZ = rgba(lx2 + 6, ty2 + 60);
  const outsideZ = rgba(lx2 - 4, ty2 + 60);
  emit({
    check: 'pattern-anchors-on-zoom',
    pass: map.zoom === 7 && isPattern(insideZ) && !isPattern(outsideZ),
    detail: `zoom ${map.zoom}, inside ${fmt(insideZ)}, outside ${fmt(outsideZ)}`,
  });

  // 5. Wheel zoom keeps the point under the cursor fixed.
  const [cx, cy] = map.getScreenPos(-105.5, 39);
  map.zoomAtPoint(cx, cy, 7.5);
  const [cx2, cy2] = map.getScreenPos(-105.5, 39);
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 7.5 && Math.abs(cx2 - cx) < 1.5 && Math.abs(cy2 - cy) < 1.5,
    detail: `zoom ${map.zoom}, polygon centre moved (${(cx2 - cx).toFixed(2)}, ${(cy2 - cy).toFixed(2)}) px`,
  });

  // 6. Pan cost and frame pacing.
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

  emit({ done: true });
}
