import { emit } from '../../../harness/page/bench.ts';
import type { CircleMap } from './circle.ts';

const CENTER: [number, number] = [-74.5, 40];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForBase(map: CircleMap, want: number, ms = 15000): Promise<number> {
  const until = performance.now() + ms;
  while (map.baseReady() < want && performance.now() < until) await sleep(50);
  return map.baseReady();
}

// Distinct 8-bit colours across the canvas, sampling every 4th pixel: a flat
// land/ocean fill gives a handful, an OSM Carto tile gives hundreds.
function distinctColours(map: CircleMap, step = 4): number {
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

export async function run(map: CircleMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  const isCircle = (px: Uint8ClampedArray): boolean =>
    px[2] > 200 && px[2] - px[0] >= 60 && px[1] >= 150;

  // Verification 0: the raster base map is drawn under the circle. The first
  // frame shows the baked land polygons; the tiles then add roads and labels.
  // Every tile in view, however many the view needs (512 px tiles drawn at
  // native size: 4 to 6 at 1024x768, not a fixed 8).
  for (let t = 0; t < 300 && !map.baseLoaded(); t++) await sleep(50);
  const visible = map.baseVisible();
  const ready = await waitForBase(map, visible);
  const colours = distinctColours(map);
  emit({
    check: 'basemap-drawn',
    pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
    detail: `${ready}/${visible} tiles ready, ${colours} distinct colours in the frame`,
  });

  // The circle checks read exact RGB, so hide the base and keep the flat land:
  // a road or label under the sampled point could otherwise pass for the fill.
  map.setBaseVisible(false);
  map.draw();

  emit({
    check: 'circle-data-loaded',
    pass: map.radiusM === 50000 && map.center[0] === CENTER[0] && map.center[1] === CENTER[1],
    detail: `radiusM=${map.radiusM}, center=[${map.center.join(',')}]`,
  });

  const [cx, cy] = map.getScreenPos(CENTER[0], CENTER[1]);
  const centerPx = pixelAt(cx, cy);
  emit({
    check: 'circle-fill-visible',
    pass: isCircle(centerPx),
    detail: `rgba(${centerPx.join(',')}) at circle centre`,
  });

  // 50 km at zoom 9 is about 213 px; 170 px must be inside, 260 px outside.
  const insidePx = pixelAt(cx + 170, cy);
  const outsidePx = pixelAt(cx + 260, cy);
  emit({
    check: 'circle-radius-kept',
    pass: isCircle(insidePx) && !isCircle(outsidePx),
    detail: `inside rgba(${insidePx.join(',')}), outside rgba(${outsidePx.join(',')})`,
  });

  map.panBy(40, 20);
  const [px2, py2] = map.getScreenPos(CENTER[0], CENTER[1]);
  const pannedPx = pixelAt(px2, py2);
  emit({
    check: 'pan-moves-circle',
    pass: Math.round(px2 - cx) === 40 && Math.round(py2 - cy) === 20 && isCircle(pannedPx),
    detail: `dx=${Math.round(px2 - cx)}, dy=${Math.round(py2 - cy)}, rgba(${pannedPx.join(',')})`,
  });

  map.setZoom(10);
  const [zx, zy] = map.getScreenPos(CENTER[0], CENTER[1]);
  const zoomPx = pixelAt(zx, zy);
  emit({
    check: 'zoom-keeps-circle',
    pass: isCircle(zoomPx),
    detail: `rgba(${zoomPx.join(',')}) at zoom 10`,
  });

  // Pan benchmark from the opening view, base map and circle both drawn.
  map.setBaseVisible(true);
  map.resetView();
  await waitForBase(map, 8);

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

  // Leave the screenshot on the opening view with the base fully loaded.
  map.resetView();
  await waitForBase(map, 8);
  emit({ done: true });
}
