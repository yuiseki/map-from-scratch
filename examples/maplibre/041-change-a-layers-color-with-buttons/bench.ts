import { emit } from '../../../harness/page/bench.ts';
import type { ButtonFillMap } from './polygon.ts';

export async function run(map: ButtonFillMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const sample = (lng: number, lat: number) => {
    const [x, y] = map.getScreenPos(lng, lat);
    return Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  };
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const near = (p: number[], rgb: number[], tol = 2) =>
    Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;
  const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // Interior sample inside the box (Addis Ababa) and outside it (ocean east).
  const LNG = 38.75;
  const LAT = 9.0;

  const p0 = sample(LNG, LAT);
  emit({
    check: 'default-fill-teal',
    pass: near(p0, [0, 136, 136]),
    detail: `${fmt(p0)} at (${LNG}, ${LAT})`,
  });

  // 1. Clicking a colour button repaints the layer.
  (document.getElementById('color-orange') as HTMLButtonElement).click();
  const p1 = sample(LNG, LAT);
  emit({
    check: 'button-sets-orange',
    pass: map.fillColor === '#ff8800' && near(p1, [255, 136, 0]),
    detail: `fillColor=${map.fillColor}, ${fmt(p1)}`,
  });

  (document.getElementById('color-purple') as HTMLButtonElement).click();
  const p2 = sample(LNG, LAT);
  emit({
    check: 'button-sets-purple',
    pass: map.fillColor === '#880088' && near(p2, [136, 0, 136]),
    detail: `fillColor=${map.fillColor}, ${fmt(p2)}`,
  });

  // 2. The random button must actually change the paint colour.
  (document.getElementById('random') as HTMLButtonElement).click();
  const random = map.fillColor;
  const p3 = sample(LNG, LAT);
  emit({
    check: 'random-button-recolours',
    pass: random !== '#880088' && near(p3, hex(random)),
    detail: `fillColor=${random}, ${fmt(p3)}`,
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

  // 4. The recoloured layer stays glued to its coordinates on pan and zoom.
  map.setZoom(4);
  const [bx, by] = map.getScreenPos(LNG, LAT);
  map.panBy(50, 30);
  const [px, py] = map.getScreenPos(LNG, LAT);
  const p4 = sample(LNG, LAT);
  map.setZoom(5);
  const [zx, zy] = map.getScreenPos(LNG, LAT);
  const p5 = sample(LNG, LAT);
  emit({
    check: 'recoloured-layer-anchors',
    pass: Math.round(px - bx) === 50 && Math.round(py - by) === 30 &&
      near(p4, hex(random)) && near(p5, hex(random)),
    detail: `pan dx=${Math.round(px - bx)}, dy=${Math.round(py - by)}; ${fmt(p4)}; z5 (${Math.round(zx)},${Math.round(zy)}) ${fmt(p5)}`,
  });

  emit({ done: true });
}
