import { emit } from '../../../harness/page/bench.ts';
import type { PopupMap } from './popup.ts';

export async function run(map: PopupMap, firstFrameMs: number): Promise<void> {
  const { canvas, ctx } = map;
  canvas.addEventListener('contextlost', () => emit({ error: 'canvas context lost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  const dpr = window.devicePixelRatio || 1;

  // Verification 1: Popup visible at target [-96, 37.8]. The bubble is read
  // 6 px inside its left edge: its centre lies on the text, and whether a
  // glyph covers that pixel depends on the font (it did on macOS).
  const b0 = map.getPopupBounds();
  const testX0 = Math.round((b0.x + 6) * dpr);
  const testY0 = Math.round((b0.y + b0.height / 2) * dpr);
  const px0 = ctx.getImageData(testX0, testY0, 1, 1).data;
  const isWhite0 = px0[0] > 250 && px0[1] > 250 && px0[2] > 250;

  emit({
    check: 'popup-visible-at-target',
    pass: isWhite0 && map.popupVisible,
    detail: `white bubble rgba(${px0.join(',')}) at center (${testX0}, ${testY0})`,
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

  // Verification 2: Popup moves synchronously with pan
  map.setZoom(3);
  const baseBounds = map.getPopupBounds();
  map.panBy(50, 30);
  const pannedBounds = map.getPopupBounds();
  const pannedTestX = Math.round((pannedBounds.x + 6) * dpr);
  const pannedTestY = Math.round((pannedBounds.y + pannedBounds.height / 2) * dpr);
  const pxPanned = ctx.getImageData(pannedTestX, pannedTestY, 1, 1).data;
  const isWhitePanned = pxPanned[0] > 250 && pxPanned[1] > 250 && pxPanned[2] > 250;

  emit({
    check: 'popup-moves-with-pan',
    pass:
      isWhitePanned &&
      Math.round(pannedBounds.x - baseBounds.x) === 50 &&
      Math.round(pannedBounds.y - baseBounds.y) === 30,
    detail: `dx=${Math.round(pannedBounds.x - baseBounds.x)}, dy=${Math.round(pannedBounds.y - baseBounds.y)}, rgba(${pxPanned.join(',')})`,
  });

  // Verification 3: Close and reopen popup
  map.setPopupVisible(false);
  const pxClosed = ctx.getImageData(pannedTestX, pannedTestY, 1, 1).data;
  const notWhiteClosed = pxClosed[0] < 245 || pxClosed[1] < 245 || pxClosed[2] < 240;

  map.setPopupVisible(true);
  const pxReopened = ctx.getImageData(pannedTestX, pannedTestY, 1, 1).data;
  const isWhiteReopened = pxReopened[0] > 250 && pxReopened[1] > 250 && pxReopened[2] > 250;

  emit({
    check: 'popup-close-and-reopen',
    pass: notWhiteClosed && isWhiteReopened,
    detail: `closed rgba(${pxClosed.join(',')}), reopened rgba(${pxReopened.join(',')})`,
  });

  // Verification 4: Popup anchors under zoom
  map.setZoom(4);
  const zoomBounds = map.getPopupBounds();
  const zoomTestX = Math.round((zoomBounds.x + 6) * dpr);
  const zoomTestY = Math.round((zoomBounds.y + zoomBounds.height / 2) * dpr);
  const pxZoom = ctx.getImageData(zoomTestX, zoomTestY, 1, 1).data;
  const isWhiteZoom = pxZoom[0] > 250 && pxZoom[1] > 250 && pxZoom[2] > 250;

  emit({
    check: 'popup-anchors-on-zoom',
    pass: isWhiteZoom,
    detail: `zoom=4 pos=(${zoomTestX}, ${zoomTestY}), rgba(${pxZoom.join(',')})`,
  });

  emit({ done: true });
}
