import { emit } from '../../../harness/page/bench.ts';
import type { SymbolCentreMap } from './symbol.ts';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const CITIES = [
  { name: 'New York', lng: -74.0, lat: 40.7, rgb: [217, 72, 15] },
  { name: 'London', lng: -0.12, lat: 51.5, rgb: [27, 138, 58] },
  { name: 'Tokyo', lng: 139.7, lat: 35.7, rgb: [179, 18, 92] },
];

export async function run(map: SymbolCentreMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const near = (p: number[], rgb: number[], tol = 24) =>
    Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;

  const fire = (type: string, x: number, y: number, buttons: number) => {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons, bubbles: true, cancelable: true,
    }));
  };
  const click = (x: number, y: number) => {
    fire('pointerdown', x, y, 1);
    fire('pointerup', x, y, 0);
  };

  // Drive the tween from the bench only.
  map.setAnimating(false);

  // 1. All three symbols are drawn at their geographic positions.
  const visible = CITIES.map((c, i) => {
    const [x, y] = map.getSymbolScreenPos(i);
    return { p: rgba(x, y - 18), ok: near(rgba(x, y - 18), c.rgb) };
  });
  emit({
    check: 'symbols-visible',
    pass: visible.every((v) => v.ok),
    detail: CITIES.map((c, i) => `${c.name}: ${fmt(visible[i].p)}`).join(' / '),
  });

  // 2. Clicking a symbol eases the map so that symbol ends at the centre.
  const [lx, ly] = map.getSymbolScreenPos(1);
  click(lx, ly - 18);
  const started = map.isAnimating();
  map.advance(700);
  const [cx, cy] = map.center;
  const [lx2, ly2] = map.getSymbolScreenPos(1);
  emit({
    check: 'click-centers-on-symbol',
    pass: started && !map.isAnimating() &&
      Math.abs(cx - mercX(CITIES[1].lng)) < 1e-9 && Math.abs(cy - mercY(CITIES[1].lat)) < 1e-9 &&
      Math.abs(lx2 - canvas.clientWidth / 2) < 0.5 && Math.abs(ly2 - canvas.clientHeight / 2) < 0.5,
    detail: `centre (${cx.toFixed(6)},${cy.toFixed(6)}), London at (${lx2.toFixed(2)},${ly2.toFixed(2)})`,
  });

  // 3. Clicking empty map leaves the view alone.
  const before = map.center;
  click(700, 620);
  const after = map.center;
  emit({
    check: 'click-empty-does-not-move',
    pass: !map.isAnimating() && before[0] === after[0] && before[1] === after[1],
    detail: `centre (${after[0].toFixed(6)},${after[1].toFixed(6)}) after empty click`,
  });

  // 4. A different symbol becomes the new centre.
  const [tx, ty] = map.getSymbolScreenPos(2);
  click(tx, ty - 18);
  map.advance(700);
  const [cx2, cy2] = map.center;
  const [tx2, ty2] = map.getSymbolScreenPos(2);
  emit({
    check: 'click-other-symbol',
    pass: Math.abs(cx2 - mercX(CITIES[2].lng)) < 1e-9 && Math.abs(cy2 - mercY(CITIES[2].lat)) < 1e-9 &&
      Math.abs(tx2 - canvas.clientWidth / 2) < 0.5 && Math.abs(ty2 - canvas.clientHeight / 2) < 0.5,
    detail: `Tokyo at (${tx2.toFixed(2)},${ty2.toFixed(2)}), centre (${cx2.toFixed(6)},${cy2.toFixed(6)})`,
  });

  // 5. Dragging empty map still pans and cancels any centring.
  const [dx0, dy0] = map.center;
  const scale = 256 * Math.pow(2, map.zoom);
  fire('pointerdown', 200, 620, 1);
  fire('pointermove', 240, 640, 1);
  fire('pointerup', 240, 640, 0);
  const [dx1, dy1] = map.center;
  emit({
    check: 'drag-pans',
    pass: Math.abs(dx1 - (dx0 - 40 / scale)) < 1e-9 && Math.abs(dy1 - (dy0 - 20 / scale)) < 1e-9,
    detail: `centre moved (${(dx1 - dx0).toExponential(3)},${(dy1 - dy0).toExponential(3)}) mercator`,
  });

  // 6. Wheel zoom about a symbol keeps it under the cursor.
  const [zx, zy] = map.getSymbolScreenPos(2);
  map.zoomAtPoint(zx, zy, 3.5);
  const [wx, wy] = map.getSymbolScreenPos(2);
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 3.5 && Math.abs(wx - zx) < 1.5 && Math.abs(wy - zy) < 1.5,
    detail: `zoom ${map.zoom}, symbol moved (${(wx - zx).toFixed(2)}, ${(wy - zy).toFixed(2)}) px`,
  });

  // 7. Pan cost and frame pacing.
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

  map.resetView();

  emit({ done: true });
}
