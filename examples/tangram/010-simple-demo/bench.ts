import { emit } from '../../../harness/page/bench.ts';
import type { TangramMap } from './map.ts';

function readPixel(ctx: CanvasRenderingContext2D, x: number, y: number, dpr: number): [number, number, number, number] {
  const img = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1);
  return [img.data[0], img.data[1], img.data[2], img.data[3]];
}

export async function run(map: TangramMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Check 1: Tangram dark palette rendered
  const oceanPos = map.getScreenCoords(0, 0);
  const pxOcean = readPixel(ctx, oceanPos.x, oceanPos.y, dpr);
  const isOcean = pxOcean[0] < 30 && pxOcean[1] < 35 && pxOcean[2] < 45;

  const landPos = map.getScreenCoords(10, 50);
  const pxLand = readPixel(ctx, landPos.x, landPos.y, dpr);
  const isLand = pxLand[0] >= 35 && pxLand[0] <= 60 && pxLand[1] >= 40 && pxLand[1] <= 65 && pxLand[2] >= 50 && pxLand[2] <= 75;

  emit({
    check: 'tangram-theme-rendered',
    pass: isOcean && isLand,
    detail: `ocean rgba(${pxOcean.join(',')}), land rgba(${pxLand.join(',')})`,
  });

  // Pan benchmark (60 frames)
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

  // Check 2: Pan moves geometry synchronously
  map.setZoom(1);
  map.center = { lon: 0, lat: 20 };
  map.draw();
  const baseLand = map.getScreenCoords(10, 50);

  map.panBy(50, 30);
  const pannedLand = map.getScreenCoords(10, 50);
  const pxPanned = readPixel(ctx, pannedLand.x, pannedLand.y, dpr);
  const isPannedLand = pxPanned[0] >= 35 && pxPanned[0] <= 60 && pxPanned[1] >= 40 && pxPanned[1] <= 65;

  emit({
    check: 'map-moves-with-pan',
    pass: isPannedLand && Math.round(pannedLand.x - baseLand.x) === 50 && Math.round(pannedLand.y - baseLand.y) === 30,
    detail: `dx=${Math.round(pannedLand.x - baseLand.x)}, dy=${Math.round(pannedLand.y - baseLand.y)}, rgba(${pxPanned.join(',')})`,
  });

  // Check 3: Zoom anchors geometry
  map.setZoom(2);
  const zoomLand = map.getScreenCoords(10, 50);
  const pxZoom = readPixel(ctx, zoomLand.x, zoomLand.y, dpr);
  const isZoomLand = pxZoom[0] >= 35 && pxZoom[0] <= 60 && pxZoom[1] >= 40 && pxZoom[1] <= 65;

  emit({
    check: 'map-anchors-on-zoom',
    pass: isZoomLand,
    detail: `zoom=2 land pos=(${Math.round(zoomLand.x)}, ${Math.round(zoomLand.y)}), rgba(${pxZoom.join(',')})`,
  });

  emit({ done: true });
}
