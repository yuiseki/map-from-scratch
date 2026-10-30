import { emit } from '../../../harness/page/bench.ts';
import type { WorldMap } from './map.ts';

export async function run(map: WorldMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const pixelAt = (lon: number, lat: number): Uint8ClampedArray => {
    const [x, y] = map.getScreenPos(lon, lat);
    return ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  };
  const isLand = (px: Uint8ClampedArray): boolean =>
    Math.abs(px[0] - 0xcc) < 12 && Math.abs(px[1] - 0xcc) < 12 && Math.abs(px[2] - 0xcc) < 12;
  const isOcean = (px: Uint8ClampedArray): boolean => px[2] > 235 && px[2] - px[0] > 8;

  // Verification 1: Europe is land at [10, 50]; the central Pacific is ocean.
  const land = pixelAt(10, 50);
  const ocean = pixelAt(-133, 13);
  emit({
    check: 'world-map-rendered',
    pass: isLand(land) && isOcean(ocean),
    detail: `land rgba(${land.join(',')}) at [10, 50], ocean rgba(${ocean.join(',')}) at [-133, 13]`,
  });

  // Verification 2: land on both sides of the antimeridian (Alaska, Chukotka);
  // a ring that was not cut at 180 deg would spill across the map instead.
  const alaska = pixelAt(-150, 65);
  const chukotka = pixelAt(170, 67);
  emit({
    check: 'antimeridian-clean',
    pass: isLand(alaska) && isLand(chukotka),
    detail: `Alaska rgba(${alaska.join(',')}), Chukotka rgba(${chukotka.join(',')})`,
  });

  // Verification 3: the 10-degree graticule is drawn over the ocean: within a
  // few pixels of the equator at 30 W some pixel differs from the ocean fill.
  const [gx, gy] = map.getScreenPos(-30, 0);
  const region = ctx.getImageData(Math.round((gx - 2) * dpr), Math.round((gy - 2) * dpr), 5, 5).data;
  let graticulePixels = 0;
  for (let i = 0; i < region.length; i += 4) {
    const r = region[i], g = region[i + 1], b = region[i + 2];
    if (!(b > 235 && b - r > 8)) graticulePixels++;
  }
  emit({
    check: 'graticule-drawn',
    pass: graticulePixels > 0,
    detail: `${graticulePixels} non-ocean pixels in 5x5 around the equator at 30 W`,
  });

  // Full redraws, as a resize or a style change would trigger them.
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    map.draw();
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }
  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  // Verification 4: the last redraw still puts land where the projection says.
  const again = pixelAt(10, 50);
  emit({
    check: 'redraw-stable',
    pass: isLand(again),
    detail: `land rgba(${again.join(',')}) after 60 redraws`,
  });

  emit({ done: true });
}
