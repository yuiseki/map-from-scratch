import { emit } from '../../../harness/page/bench.ts';
import type { SolarTerminatorMap } from './map.ts';

export async function run(map: SolarTerminatorMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  const atLonLat = (lon: number, lat: number): Uint8ClampedArray => {
    const p = map.screenPos(lon, lat);
    return pixelAt(p.x, p.y);
  };
  const max = (px: Uint8ClampedArray): number => Math.max(px[0], px[1], px[2]);
  const rgba = (px: Uint8ClampedArray): string => `rgba(${px[0]},${px[1]},${px[2]})`;

  emit({
    check: 'land-loaded',
    pass: map.polygons.length > 100,
    detail: `${map.polygons.length} land polygons`,
  });

  map.setUtcHour(12);
  map.setZoom(1);
  const sun = map.subsolar();
  emit({
    check: 'subsolar-position',
    pass: Math.abs(sun.lon + 4) < 3 && sun.lat < -11 && sun.lat > -15,
    detail: `2026-10-30 12:00 UTC -> lon=${sun.lon.toFixed(2)}, lat=${sun.lat.toFixed(2)}`,
  });

  // 40 px east of the subsolar point, away from the sun marker itself.
  const sunPx = map.screenPos(sun.lon, sun.lat);
  const dayPx = pixelAt(sunPx.x + 40, sunPx.y);
  emit({
    check: 'day-near-subsolar-point',
    pass: max(dayPx) > 170,
    detail: `${rgba(dayPx)} 40px east of the subsolar point`,
  });

  const nightPx = atLonLat(sun.lon + 180, -sun.lat);
  emit({
    check: 'night-at-antisolar-point',
    pass: max(nightPx) < 150,
    detail: `${rgba(nightPx)} at the antisolar point`,
  });

  const polarNight = atLonLat(sun.lon, 80);
  emit({
    check: 'night-over-north-pole-in-october',
    pass: max(polarNight) < 150,
    detail: `${rgba(polarNight)} at 80N on the noon meridian`,
  });

  const polarDay = atLonLat(sun.lon, -80);
  emit({
    check: 'day-over-south-pole-in-october',
    pass: max(polarDay) > 170,
    detail: `${rgba(polarDay)} at 80S on the noon meridian`,
  });

  // North of the Arctic Circle in late October the night is wide: 90 degrees
  // west of the noon meridian at 76N is night, only 16 degrees around noon is day.
  const highLatNight = atLonLat(sun.lon - 90, 76);
  emit({
    check: 'night-at-76n-west-of-noon',
    pass: max(highLatNight) < 150,
    detail: `${rgba(highLatNight)} at 76N, 90 deg west of the subsolar meridian`,
  });

  const midnight = (() => {
    map.setUtcHour(0);
    return atLonLat(0, 0);
  })();
  map.setUtcHour(12);
  const noon = atLonLat(0, 0);
  emit({
    check: 'hour-moves-terminator',
    pass: max(midnight) < 150 && max(noon) > 170,
    detail: `0E 0N: 00:00 UTC ${rgba(midnight)}, 12:00 UTC ${rgba(noon)}`,
  });

  const before = map.screenPos(sun.lon, sun.lat);
  map.panBy(40, 20);
  const after = map.screenPos(sun.lon, sun.lat);
  const movedPx = pixelAt(after.x, after.y);
  emit({
    check: 'pan-moves-sun-marker',
    pass:
      Math.round(after.x - before.x) === 40 &&
      Math.round(after.y - before.y) === 20 &&
      movedPx[0] > 200 && movedPx[1] > 150 && movedPx[2] < 170,
    detail: `dx=${Math.round(after.x - before.x)}, dy=${Math.round(after.y - before.y)}, ${rgba(movedPx)}`,
  });

  map.setZoom(2);
  const zoomedPx = pixelAt(map.screenPos(sun.lon, sun.lat).x, map.screenPos(sun.lon, sun.lat).y);
  emit({
    check: 'zoom-keeps-sun-marker',
    pass: zoomedPx[0] > 200 && zoomedPx[1] > 150 && zoomedPx[2] < 170,
    detail: `${rgba(zoomedPx)} at zoom 2`,
  });

  // Wheel zoom must keep the place under the pointer, not the screen centre.
  const anchor = map.screenPos(sun.lon, sun.lat);
  map.zoomAt(3, anchor.x, anchor.y);
  const held = map.screenPos(sun.lon, sun.lat);
  emit({
    check: 'wheel-zoom-keeps-point',
    pass:
      map.zoom === 3 &&
      Math.abs(held.x - anchor.x) < 1.5 && Math.abs(held.y - anchor.y) < 1.5,
    detail: `sun at (${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}) before, (${held.x.toFixed(1)}, ${held.y.toFixed(1)}) after zoom 3`,
  });

  map.setZoom(1);
  map.panBy(-40, -20);
  map.setUtcHour(6);

  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.setUtcHour(6 + i * 0.1);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }
  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  map.setUtcHour(12);
  emit({ done: true });
}
