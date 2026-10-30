import { emit } from '../../../harness/page/bench.ts';
import type { GeoJsonLineMap } from './line.ts';

export async function run(map: GeoJsonLineMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Test point on route: point 9 in the route
  const testLng = -122.48610019683838;
  const testLat = 37.82880236636284;

  // Verification 1: Line rendered with default gray color (#888888)
  const [sx0, sy0] = map.getScreenPos(testLng, testLat);
  const px0 = ctx.getImageData(Math.round(sx0 * dpr), Math.round(sy0 * dpr), 1, 1).data;
  const isGray0 =
    Math.abs(px0[0] - 136) < 20 &&
    Math.abs(px0[1] - 136) < 20 &&
    Math.abs(px0[2] - 136) < 20;

  emit({
    check: 'line-rendered-gray',
    pass: isGray0,
    detail: `rgba(${px0[0]},${px0[1]},${px0[2]},${px0[3]}) at (${Math.round(sx0)},${Math.round(sy0)})`,
  });

  // Measure pan frame interval and redraw cost
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

  // Verification 2: Line moves synchronously with pan
  map.setZoom(15);
  const [baseX, baseY] = map.getScreenPos(testLng, testLat);
  map.panBy(60, 40);
  const [pannedX, pannedY] = map.getScreenPos(testLng, testLat);
  const pxPan = ctx.getImageData(Math.round(pannedX * dpr), Math.round(pannedY * dpr), 1, 1).data;
  const isGrayPan =
    Math.abs(pxPan[0] - 136) < 20 &&
    Math.abs(pxPan[1] - 136) < 20 &&
    Math.abs(pxPan[2] - 136) < 20;

  emit({
    check: 'line-moves-with-pan',
    pass: isGrayPan && Math.round(pannedX - baseX) === 60 && Math.round(pannedY - baseY) === 40,
    detail: `dx=${Math.round(pannedX - baseX)}, dy=${Math.round(pannedY - baseY)}, rgba(${pxPan[0]},${pxPan[1]},${pxPan[2]},${pxPan[3]})`,
  });

  // Verification 3: Restyling updates stroke color and width
  map.setLineStyle('#3887be', 12);
  const pxStyled = ctx.getImageData(Math.round(pannedX * dpr), Math.round(pannedY * dpr), 1, 1).data;
  // #3887be is r=56, g=135, b=190
  const isBlue = pxStyled[0] < 80 && pxStyled[1] > 110 && pxStyled[2] > 160;
  emit({
    check: 'line-restyled',
    pass: isBlue,
    detail: `rgba(${pxStyled[0]},${pxStyled[1]},${pxStyled[2]},${pxStyled[3]}) after setLineStyle('#3887be', 12)`,
  });

  // Verification 4: Line stays anchored to coordinates under zoom
  map.setZoom(16);
  const [zoomX, zoomY] = map.getScreenPos(testLng, testLat);
  const pxZoom = ctx.getImageData(Math.round(zoomX * dpr), Math.round(zoomY * dpr), 1, 1).data;
  const isBlueZoom = pxZoom[0] < 80 && pxZoom[1] > 110 && pxZoom[2] > 160;
  emit({
    check: 'line-anchors-on-zoom',
    pass: isBlueZoom,
    detail: `zoom=16 pos=(${Math.round(zoomX)},${Math.round(zoomY)}), rgba(${pxZoom[0]},${pxZoom[1]},${pxZoom[2]},${pxZoom[3]})`,
  });

  emit({ done: true });
}
