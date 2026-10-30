import { emit } from '../../../harness/page/bench.ts';
import type { PopupPointsMap } from './map.ts';

export async function run(map: PopupPointsMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const at = (name: string) => {
    const p = map.points.find((q) => q.name === name)!;
    return map.screenFromMercator(p.mx, p.my);
  };

  // 1. Each point is drawn in its own colour, 4 px off-centre (clear of the white core).
  const [tx, ty] = at('Tokyo');
  const tokyoPx = rgba(tx + 4, ty);
  emit({
    check: 'tokyo-point-visible',
    pass: tokyoPx[0] < 100 && tokyoPx[1] > 150 && tokyoPx[2] > 200,
    detail: `${fmt(tokyoPx)} at Tokyo (${Math.round(tx)},${Math.round(ty)})`,
  });

  const [nx, ny] = at('New York');
  const nyPx = rgba(nx + 4, ny);
  emit({
    check: 'new-york-point-visible',
    pass: nyPx[0] > 200 && nyPx[1] > 100 && nyPx[1] < 200 && nyPx[2] < 80,
    detail: `${fmt(nyPx)} at New York (${Math.round(nx)},${Math.round(ny)})`,
  });

  const [lx, ly] = at('London');
  const londonPx = rgba(lx + 4, ly);
  emit({
    check: 'london-point-visible',
    pass: londonPx[0] > 120 && londonPx[1] > 100 && londonPx[2] > 200,
    detail: `${fmt(londonPx)} at London (${Math.round(lx)},${Math.round(ly)})`,
  });

  // 2. Clicking a point opens its own popup.
  map.clickAtScreen(tx, ty);
  emit({
    check: 'click-tokyo-shows-popup',
    pass: map.activePopup?.text === 'Tokyo, Japan',
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  const bubble = rgba(tx, ty - 61);
  emit({
    check: 'popup-painted-in-canvas',
    pass: bubble[0] > 240 && bubble[1] > 240 && bubble[2] > 240,
    detail: `${fmt(bubble)} at the popup body (${Math.round(tx)},${Math.round(ty - 61)})`,
  });

  map.clickAtScreen(nx, ny);
  emit({
    check: 'click-new-york-shows-popup',
    pass: map.activePopup?.text === 'New York, USA',
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  map.clickAtScreen(lx, ly);
  emit({
    check: 'click-london-shows-popup',
    pass: map.activePopup?.text === 'London, UK',
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  // 3. Pan cost and frame pacing.
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

  // 4. Wheel zoom keeps the point under the cursor fixed.
  const [ax, ay] = at('London');
  map.zoomAt(3, ax, ay);
  const [bx, by] = at('London');
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 3 && Math.abs(bx - ax) < 1.5 && Math.abs(by - ay) < 1.5,
    detail: `zoom ${map.zoom}, anchor moved (${(bx - ax).toFixed(2)}, ${(by - ay).toFixed(2)}) px`,
  });

  emit({ done: true });
}
