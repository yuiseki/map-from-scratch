import { emit } from '../../../harness/page/bench.ts';
import type { FiltersMap } from './map.ts';

export async function run(map: FiltersMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const near = (x: number, y: number, test: (p: Uint8ClampedArray) => boolean): boolean => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = ctx.getImageData(Math.round((x + dx) * dpr), Math.round((y + dy) * dpr), 1, 1).data;
        if (test(px)) return true;
      }
    }
    return false;
  };
  const isOrange = (p: Uint8ClampedArray): boolean => p[0] > 200 && p[1] > 80 && p[1] < 180 && p[2] < 110;
  const isBlue = (p: Uint8ClampedArray): boolean => p[0] < 110 && p[1] < 160 && p[2] > 170;
  const isGreen = (p: Uint8ClampedArray): boolean => p[0] < 120 && p[1] > 120 && p[2] < 140;

  emit({
    check: 'classes-loaded',
    pass: map.groups.SR.length > 50 && map.groups.I.length > 5 && map.groups.US.length >= 1,
    detail: `SR=${map.groups.SR.length}, US=${map.groups.US.length}, I=${map.groups.I.length}`,
  });

  const [sx, sy] = map.screenFromMercator(map.probes.SR[0], map.probes.SR[1]);
  const [ix, iy] = map.screenFromMercator(map.probes.I[0], map.probes.I[1]);
  const [ux, uy] = map.screenFromMercator(map.probes.US[0], map.probes.US[1]);

  const srOrange = near(sx, sy, isOrange);
  const iBlue = near(ix, iy, isBlue);
  emit({ check: 'state-routes-visible', pass: srOrange, detail: `orange near SR probe (${Math.round(sx)},${Math.round(sy)})` });
  emit({ check: 'interstates-visible', pass: iBlue, detail: `blue near I probe (${Math.round(ix)},${Math.round(iy)})` });

  map.setTypeVisible('SR', false);
  const srHidden = !near(sx, sy, isOrange);
  const iStill = near(ix, iy, isBlue);
  emit({
    check: 'filter-hides-state',
    pass: srHidden && iStill,
    detail: `SR hidden=${srHidden}, interstates still visible=${iStill}`,
  });

  map.setTypeVisible('SR', true);
  const srBack = near(sx, sy, isOrange);
  emit({ check: 'filter-restores-state', pass: srBack, detail: `orange back near SR probe=${srBack}` });

  // US highways exist only twice, but must be drawn when enabled.
  emit({ check: 'us-highways-drawn', pass: near(ux, uy, isGreen), detail: `green near US probe (${Math.round(ux)},${Math.round(uy)})` });

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
