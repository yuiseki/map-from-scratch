import { emit } from '../../../harness/page/bench.ts';
import type { SunGlobe } from './globe.ts';

const lum = (d: Uint8ClampedArray): number => 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];

export async function run(globe: SunGlobe, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = globe;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const px = (x: number, y: number): Uint8ClampedArray =>
    ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  const lumAt = (lon: number, lat: number): number => {
    const p = globe.project(lon, lat);
    const d = px(p.sx, p.sy);
    return lum(d);
  };

  // 1. The disc is drawn and space stays outside it.
  globe.yaw = 0;
  globe.pitch = 0.3;
  globe.setSun(90);
  const litLum = lumAt(45, 0);
  const cornerLum = lum(px(6, 6));
  emit({
    check: 'globe-disc-drawn',
    pass: litLum > 25 && cornerLum < 12,
    detail: `lit ocean ${litLum.toFixed(1)}, corner ${cornerLum.toFixed(1)}`,
  });

  // 2. Day side brighter than night side. At sun lon 90 the terminator runs
  // through lon 45/-45, both ocean and both visible.
  const day1 = lumAt(45, 0);
  const night1 = lumAt(-45, 0);
  emit({
    check: 'day-night-contrast',
    pass: day1 - night1 > 25,
    detail: `day(lon 45)=${day1.toFixed(1)} night(lon -45)=${night1.toFixed(1)}`,
  });

  // 3. Moving the sun 180 degrees swaps which side is lit.
  globe.setSun(-90);
  const day2 = lumAt(-45, 0);
  const night2 = lumAt(45, 0);
  globe.setSun(90);
  emit({
    check: 'terminator-moves-with-sun',
    pass: day1 - night2 > 25 && day2 - night1 > 25,
    detail: `lon 45 ${day1.toFixed(1)} -> ${night2.toFixed(1)}, lon -45 ${night1.toFixed(1)} -> ${day2.toFixed(1)}`,
  });

  // 4. The lit point is fixed in world space: rotating the globe moves it on
  // screen and it stays lit (a screen-space mask would leave it behind).
  globe.setSun(40);
  const before = globe.project(40, 0);
  const beforeLum = lum(px(before.sx, before.sy));
  globe.yaw = 0.8;
  globe.draw();
  const after = globe.project(40, 0);
  const afterLum = lum(px(after.sx, after.sy));
  const moved = Math.hypot(after.sx - before.sx, after.sy - before.sy);
  emit({
    check: 'light-stays-on-the-world',
    pass: before.visible && after.visible && moved > 40 && beforeLum > 25 && afterLum > 25,
    detail: `sun point moved ${moved.toFixed(0)} px; luminance ${beforeLum.toFixed(1)} -> ${afterLum.toFixed(1)}`,
  });

  globe.yaw = 0;
  globe.pitch = 0.3;
  globe.setSun(40);
  globe.draw();

  // Rotation cost, mask included.
  const raf = () => new Promise<number>(requestAnimationFrame);
  const redrawTimes: number[] = [];
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    globe.rotateBy(0.02, Math.sin(i * 0.1) * 0.005);
    redrawTimes.push(performance.now() - t0);
    const now = await raf();
    frameIntervals.push(now - last);
    last = now;
  }
  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  emit({ done: true });
}
