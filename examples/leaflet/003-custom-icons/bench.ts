import { emit } from '../../../harness/page/bench.ts';
import { ICONS } from './map.ts';
import type { CustomIconsMap } from './map.ts';

export async function run(map: CustomIconsMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;

  const [pin, square, circle] = ICONS;

  // 1. Every hand-drawn icon is on the canvas at its projected position.
  const [px, py] = map.getScreenPos(pin.lat, pin.lng);
  const pinPx = rgba(px, py - 27);
  emit({
    check: 'pin-icon-visible',
    pass: pinPx[0] < 80 && pinPx[1] > 90 && pinPx[1] < 160 && pinPx[2] > 160,
    detail: `${fmt(pinPx)} at the pin head (${Math.round(px)},${Math.round(py - 27)})`,
  });

  const [sx, sy] = map.getScreenPos(square.lat, square.lng);
  const squarePx = rgba(sx - 7, sy - 14);
  emit({
    check: 'square-icon-visible',
    pass: squarePx[0] > 180 && squarePx[1] < 130 && squarePx[2] < 80,
    detail: `${fmt(squarePx)} at the square badge (${Math.round(sx - 7)},${Math.round(sy - 14)})`,
  });

  const [cx, cy] = map.getScreenPos(circle.lat, circle.lng);
  const circlePx = rgba(cx - 6, cy - 12);
  emit({
    check: 'circle-icon-visible',
    pass: circlePx[0] < 100 && circlePx[1] > 120 && circlePx[2] < 110,
    detail: `${fmt(circlePx)} at the circle badge (${Math.round(cx - 6)},${Math.round(cy - 12)})`,
  });

  // 2. Each icon opens its own popup.
  map.clickAtScreen(cx, cy - 12);
  emit({
    check: 'click-circle-shows-popup',
    pass: map.activePopup?.text === 'I am the circle icon.',
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  map.clickAtScreen(sx, sy - 14);
  emit({
    check: 'click-square-shows-popup',
    pass: map.activePopup?.text === 'I am the square icon.',
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  map.clickAtScreen(px, py - 16);
  emit({
    check: 'click-pin-shows-popup',
    pass: map.activePopup?.text === 'I am the pin icon.',
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  // Popups are painted into the canvas, not as DOM nodes.
  const bubble = rgba(px, py - 56);
  emit({
    check: 'popup-painted-in-canvas',
    pass: bubble[0] > 240 && bubble[1] > 240 && bubble[2] > 240,
    detail: `${fmt(bubble)} at the bubble body (${Math.round(px)},${Math.round(py - 56)})`,
  });

  // 3. A click on empty map reports the coordinates.
  const emptyX = canvas.clientWidth * 0.2;
  const emptyY = canvas.clientHeight * 0.85;
  map.clickAtScreen(emptyX, emptyY);
  emit({
    check: 'click-empty-shows-coordinates',
    pass: map.activePopup?.text.startsWith('You clicked at (') === true,
    detail: `activePopup="${map.activePopup?.text}"`,
  });

  // 4. A 2 px wobble between press and release still counts as a click.
  const rect = canvas.getBoundingClientRect();
  const fire = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: 7,
      pointerType: 'mouse',
      bubbles: true,
    }));
  fire('pointerdown', px, py - 16);
  fire('pointermove', px + 2, py - 16);
  fire('pointerup', px + 2, py - 16);
  emit({
    check: 'click-tolerance-2px',
    pass: map.activePopup?.text === 'I am the pin icon.',
    detail: `activePopup="${map.activePopup?.text}" after a 2 px pointer wobble`,
  });
  map.panBy(2, 0);

  // 5. Wheel zoom keeps the point under the cursor fixed.
  const [ax, ay] = map.getScreenPos(pin.lat, pin.lng);
  map.zoomAtPoint(ax, ay, 14);
  const [bx, by] = map.getScreenPos(pin.lat, pin.lng);
  emit({
    check: 'wheel-zoom-keeps-point',
    pass: map.zoom === 14 && Math.abs(bx - ax) < 1.5 && Math.abs(by - ay) < 1.5,
    detail: `zoom ${map.zoom}, anchor moved (${(bx - ax).toFixed(2)}, ${(by - ay).toFixed(2)}) px`,
  });
  map.setZoom(13);

  // 6. Pan cost and frame pacing.
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
