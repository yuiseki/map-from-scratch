import { emit } from '../../../harness/page/bench.ts';
import type { ClickPopupMap } from './popup.ts';

export async function run(map: ClickPopupMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;
  const rgba = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
  const fmt = (p: number[]) => `rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
  const isWhite = (p: number[]) => p[0] > 245 && p[1] > 245 && p[2] > 245;

  // A point on the bubble away from the rounded corners and the text.
  const bubbleSample = () => {
    const b = map.getPopupBounds();
    return rgba(b.x + 16, b.y + 9);
  };

  const click = (x: number, y: number) => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      canvas.dispatchEvent(new PointerEvent(type, {
        clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true, cancelable: true,
      }));
    }
  };

  // 1. Nothing is drawn until the user clicks.
  const initial = rgba(map.canvas.clientWidth / 2, map.canvas.clientHeight / 2);
  emit({
    check: 'popup-hidden-initially',
    pass: !map.popupVisible && !isWhite(initial),
    detail: `popupVisible=${map.popupVisible}, centre ${fmt(initial)}`,
  });

  // 2. A click opens the popup with its tip at the clicked point.
  const p1 = [680, 280] as const;
  click(p1[0], p1[1]);
  const [ax1, ay1] = map.getScreenPos(...map.getPopupAnchor());
  const b1 = map.getPopupBounds();
  const bubble1 = bubbleSample();
  const tipX1 = b1.x + b1.width / 2, tipY1 = b1.y + b1.height + 10;
  emit({
    check: 'click-opens-popup-at-pointer',
    pass: map.popupVisible && isWhite(bubble1) &&
      Math.abs(ax1 - p1[0]) < 0.5 && Math.abs(ay1 - p1[1]) < 0.5 &&
      Math.abs(tipX1 - ax1) < 0.5 && Math.abs(tipY1 - ay1) < 0.5,
    detail: `anchor at (${ax1.toFixed(2)},${ay1.toFixed(2)}), tip (${tipX1.toFixed(2)},${tipY1.toFixed(2)}), bubble ${fmt(bubble1)}`,
  });

  // 3. The × closes the popup and does not reopen it.
  const btn = map.getPopupBounds().closeBtn;
  const closedAt = [b1.x + 16, b1.y + 9] as const;
  click(btn.x + btn.size / 2, btn.y + btn.size / 2);
  const afterClose = rgba(closedAt[0], closedAt[1]);
  emit({
    check: 'close-button-closes-popup',
    pass: !map.popupVisible && !isWhite(afterClose),
    detail: `popupVisible=${map.popupVisible}, former bubble ${fmt(afterClose)}`,
  });

  // 4. Clicking elsewhere moves the whole popup there.
  const p2 = [400, 520] as const;
  const oldSpot = rgba(b1.x + 16, b1.y + 9);
  click(p2[0], p2[1]);
  const [ax2, ay2] = map.getScreenPos(...map.getPopupAnchor());
  const bubble2 = bubbleSample();
  emit({
    check: 'click-elsewhere-reanchors',
    pass: map.popupVisible && isWhite(bubble2) && !isWhite(oldSpot) &&
      Math.abs(ax2 - p2[0]) < 0.5 && Math.abs(ay2 - p2[1]) < 0.5,
    detail: `anchor at (${ax2.toFixed(2)},${ay2.toFixed(2)}), old spot ${fmt(oldSpot)}, new bubble ${fmt(bubble2)}`,
  });

  // 5. Panning moves the popup with the map, tip still on the anchor.
  const before = map.getPopupBounds();
  map.panBy(40, 25);
  const after = map.getPopupBounds();
  const [px, py] = map.getScreenPos(...map.getPopupAnchor());
  emit({
    check: 'popup-follows-pan',
    pass: Math.round(after.x - before.x) === 40 && Math.round(after.y - before.y) === 25 &&
      Math.abs(after.x + after.width / 2 - px) < 0.5 &&
      Math.abs(after.y + after.height + 10 - py) < 0.5 && isWhite(bubbleSample()),
    detail: `bubble moved (${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}) px, tip (${px.toFixed(1)},${py.toFixed(1)})`,
  });

  // 6. Zooming about the tip keeps the popup anchored to the same geographic
  // point at the same screen position.
  map.zoomAtPoint(px, py, 5);
  const [zx, zy] = map.getScreenPos(...map.getPopupAnchor());
  const zoomBounds = map.getPopupBounds();
  emit({
    check: 'popup-anchors-on-zoom',
    pass: map.zoom === 5 &&
      Math.abs(zoomBounds.x + zoomBounds.width / 2 - zx) < 0.5 &&
      Math.abs(zoomBounds.y + zoomBounds.height + 10 - zy) < 0.5 &&
      Math.abs(zx - px) < 1.5 && Math.abs(zy - py) < 1.5 && isWhite(bubbleSample()),
    detail: `zoom ${map.zoom}, tip (${zx.toFixed(1)},${zy.toFixed(1)}) from (${px.toFixed(1)},${py.toFixed(1)}), bubble ${fmt(bubbleSample())}`,
  });

  // 7. Pan cost and frame pacing with the popup on screen.
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

  // Leave a fresh click on screen for the screenshot.
  map.setZoom(3);
  click(512, 320);

  emit({ done: true });
}
