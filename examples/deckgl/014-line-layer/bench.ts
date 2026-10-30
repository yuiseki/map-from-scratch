import { emit } from '../../../harness/page/bench.ts';
import type { LineLayerMap } from './map.ts';

export async function run(map: LineLayerMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const scale = 256 * Math.pow(2, map.zoom);

  const screenLen = (l: (typeof map.lines)[number]): number =>
    Math.hypot((l.tx - l.sx) * scale, (l.ty - l.sy) * scale);
  const mid = (l: (typeof map.lines)[number]): [number, number] => [(l.sx + l.tx) / 2, (l.sy + l.ty) / 2];

  const anyInWindow = (x: number, y: number, test: (p: number[]) => boolean, size = 9): boolean => {
    const half = Math.floor(size / 2);
    const data = ctx.getImageData(
      Math.round((x - half) * dpr),
      Math.round((y - half) * dpr),
      Math.round(size * dpr),
      Math.round(size * dpr),
    ).data;
    for (let i = 0; i < data.length; i += 4) {
      if (test([data[i], data[i + 1], data[i + 2], data[i + 3]])) return true;
    }
    return false;
  };
  const isCyan = (p: number[]) => p[0] < 110 && p[1] > 110 && p[2] > 150;
  const isOrange = (p: number[]) => p[0] > 150 && p[1] > 80 && p[1] < 200 && p[2] < 90;

  // Colour census over the whole frame: both layer colours must cover a real
  // area, not just one lucky pixel.
  const w = canvas.width;
  const h = canvas.height;
  const pixels = ctx.getImageData(0, 0, w, h).data;
  let cyanPx = 0;
  let orangePx = 0;
  for (let i = 0; i < pixels.length; i += 8) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (r < 110 && g > 110 && b > 150) cyanPx++;
    else if (r > 150 && g > 80 && g < 200 && b < 90) orangePx++;
  }
  const minPx = Math.round((w * h) / 8 / 100); // 1% of the sampled pixels
  emit({
    check: 'flow-directions-visible',
    pass: cyanPx > minPx && orangePx > minPx,
    detail: `cyan=${cyanPx}px orange=${orangePx}px (min ${minPx})`,
  });

  // Longest lines of each direction, scanned longest-first for one whose
  // midpoint pixel still shows its own colour (dense clusters hide some).
  const byLength = (sign: number) =>
    map.lines.filter((l) => (sign > 0 ? l.v > 0 : l.v < 0)).sort((a, b) => screenLen(b) - screenLen(a)).slice(0, 25);
  const findVisible = (sign: number, test: (p: number[]) => boolean): { l: (typeof map.lines)[number]; x: number; y: number; len: number } | null => {
    for (const l of byLength(sign)) {
      const [mx, my] = mid(l);
      const [x, y] = map.screenOfWorld(mx, my);
      if (x < 5 || y < 5 || x > w - 5 || y > h - 5) continue;
      if (anyInWindow(x, y, test)) return { l, x, y, len: screenLen(l) };
    }
    return null;
  };
  const east = findVisible(1, isCyan);
  const west = findVisible(-1, isOrange);
  emit({
    check: 'line-layer-visible',
    pass: !!east && !!west,
    detail: east && west
      ? `eastward v=${east.l.v} ${Math.round(east.len)}px at (${Math.round(east.x)},${Math.round(east.y)}); ` +
        `westward v=${west.l.v} ${Math.round(west.len)}px at (${Math.round(west.x)},${Math.round(west.y)})`
      : `missing ${!east ? 'eastward' : 'westward'} line colour`,
  });

  // Lines move with the map by exactly the pan offset.
  const specimen = east ?? west;
  if (specimen) {
    const [mx, my] = mid(specimen.l);
    map.panBy(50, 30);
    const [x2, y2] = map.screenOfWorld(mx, my);
    emit({
      check: 'lines-move-with-pan',
      pass:
        Math.round(x2 - specimen.x) === 50 &&
        Math.round(y2 - specimen.y) === 30 &&
        anyInWindow(x2, y2, specimen === east ? isCyan : isOrange),
      detail: `dx=${Math.round(x2 - specimen.x)}, dy=${Math.round(y2 - specimen.y)}`,
    });
  } else {
    emit({ check: 'lines-move-with-pan', pass: false, detail: 'no visible specimen line' });
  }

  // Wheel zoom keeps the point under the cursor fixed.
  const [cx, cy] = specimen ? map.screenOfWorld(...mid(specimen.l)) : [w / 2, h / 2];
  map.zoomAtPoint(cx, cy, 4.2);
  const [zx, zy] = map.screenOfWorld(...mid(specimen ? specimen.l : map.lines[0]));
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 4.2 && Math.abs(zx - cx) < 1.5 && Math.abs(zy - cy) < 1.5,
    detail: `zoom ${map.zoom}, anchor moved (${(zx - cx).toFixed(2)}, ${(zy - cy).toFixed(2)}) px`,
  });
  map.setZoom(3.4);

  // Pan cost and frame pacing over the whole path.
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
