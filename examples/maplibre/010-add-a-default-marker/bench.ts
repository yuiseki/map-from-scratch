import { emit } from '../../../harness/page/bench.ts';
import type { MarkerMap } from './marker.ts';

export async function run(map: MarkerMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Marker visible at target
  const [sx0, sy0] = map.getMarkerScreenPos();
  const px0 = ctx.getImageData(Math.round(sx0 * dpr), Math.round((sy0 - 18) * dpr), 1, 1).data;
  const isCyan0 = px0[0] < 100 && px0[1] > 130 && px0[2] > 160;
  emit({
    check: 'marker-visible-at-target',
    pass: isCyan0,
    detail: `rgba(${px0[0]},${px0[1]},${px0[2]},${px0[3]}) at (${Math.round(sx0)},${Math.round(sy0 - 18)})`,
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

  // Verification 2: Marker moves synchronously with pan
  // Reset and pan by fixed offset (+50, +30)
  map.setZoom(5);
  const [baseX, baseY] = map.getMarkerScreenPos();
  map.panBy(50, 30);
  const [pannedX, pannedY] = map.getMarkerScreenPos();
  const pxPan = ctx.getImageData(Math.round(pannedX * dpr), Math.round((pannedY - 18) * dpr), 1, 1).data;
  const isCyanPan = pxPan[0] < 100 && pxPan[1] > 130 && pxPan[2] > 160;
  emit({
    check: 'marker-moves-with-pan',
    pass: isCyanPan && Math.round(pannedX - baseX) === 50 && Math.round(pannedY - baseY) === 30,
    detail: `dx=${Math.round(pannedX - baseX)}, dy=${Math.round(pannedY - baseY)}, rgba(${pxPan[0]},${pxPan[1]},${pxPan[2]},${pxPan[3]})`,
  });

  // Verification 3: Marker stays anchored to coordinates under zoom
  map.setZoom(7);
  const [zoomX, zoomY] = map.getMarkerScreenPos();
  const pxZoom = ctx.getImageData(Math.round(zoomX * dpr), Math.round((zoomY - 18) * dpr), 1, 1).data;
  const isCyanZoom = pxZoom[0] < 100 && pxZoom[1] > 130 && pxZoom[2] > 160;
  emit({
    check: 'marker-anchors-on-zoom',
    pass: isCyanZoom,
    detail: `zoom=7 pos=(${Math.round(zoomX)},${Math.round(zoomY)}), rgba(${pxZoom[0]},${pxZoom[1]},${pxZoom[2]},${pxZoom[3]})`,
  });

  emit({ done: true });
}
