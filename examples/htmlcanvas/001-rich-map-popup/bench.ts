// examples/htmlcanvas/001-rich-map-popup/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { MapPopupView } from './map.ts';

export async function runBench(map: MapPopupView, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Check 1: the harness browser (stable Chrome, no flags) has the API. The
  // fallback is for other browsers; a ?fallback run would measure that.
  emit({
    check: 'html-in-canvas-supported',
    pass: map.htmlInCanvas,
    detail: map.htmlInCanvas
      ? 'canvas.content reflects "drawable"; popup drawn with drawElementImage'
      : 'no HTML-in-Canvas; popup is a DOM overlay',
  });

  // Check 2: Landmarks loaded
  emit({
    check: 'landmarks-loaded',
    pass: map.landmarks.length === 5,
    detail: `Loaded ${map.landmarks.length} Tokyo landmarks (expected 5)`,
  });

  // Check 3: Popup rendered on canvas pixels
  const pRectInitial = map.getPopupRect();
  const bRectInitial = map.getButtonRect();

  // Center of popup card (should be white background: [255, 255, 255, 255])
  const cardPixel = map.readPixel(pRectInitial.x + 40, pRectInitial.y + 40);
  const isCardWhite = cardPixel[0] > 240 && cardPixel[1] > 240 && cardPixel[2] > 240;

  // Center of button (initial state is blue #2563eb: [37, 99, 235])
  const btnPixel = map.readPixel(
    bRectInitial.x + bRectInitial.width / 2,
    bRectInitial.y + bRectInitial.height / 2,
  );
  const isBtnBlue = btnPixel[2] > 200 && btnPixel[0] < 80;

  emit({
    check: 'popup-rendered-on-canvas',
    pass: isCardWhite && isBtnBlue,
    detail: `Popup card pixel: rgba(${cardPixel.join(',')}), Button pixel: rgba(${btnPixel.join(',')})`,
  });

  // Check 4: the browser's own hit testing finds the button where it was
  // drawn, and a click on what it found reaches the button's handler. In 2D
  // the hit-test box follows drawElementImage by itself.
  const box = canvas.getBoundingClientRect();
  const k = box.width / canvas.width;
  const atButton = (r: { x: number; y: number; width: number; height: number }) =>
    document.elementFromPoint(box.left + (r.x + r.width / 2) * k, box.top + (r.y + r.height / 2) * k);
  const hitButton = atButton(bRectInitial);
  const hitMap = document.elementFromPoint(box.left + 5, box.top + box.height - 5);
  emit({
    check: 'button-hit-where-drawn',
    pass: hitButton === map.popupButton && hitMap === canvas,
    detail: `elementFromPoint at the drawn button: ${hitButton?.id || hitButton?.tagName}, at a map corner: ${hitMap?.id || hitMap?.tagName}`,
  });
  (hitButton as HTMLElement | null)?.click();
  await map.render();
  const btnPixelActive = map.readPixel(
    bRectInitial.x + bRectInitial.width / 2,
    bRectInitial.y + bRectInitial.height / 2,
  );
  // Active state is green #16a34a: [22, 163, 74]
  const isBtnGreen = btnPixelActive[1] > 140 && btnPixelActive[0] < 50;

  emit({
    check: 'button-interactive',
    pass: map.bookmarked && isBtnGreen,
    detail: `Bookmarked: ${map.bookmarked}, Active button pixel: rgba(${btnPixelActive.join(',')})`,
  });

  // Check 5: Geographic anchor follows pan and shifts popup
  const anchorBefore = map.getAnchorPos();
  const pRectBefore = map.getPopupRect();
  await map.panBy(120, 80);
  const anchorAfter = map.getAnchorPos();
  const pRectAfter = map.getPopupRect();

  const dxAnchor = Math.round(anchorAfter.x - anchorBefore.x);
  const dyAnchor = Math.round(anchorAfter.y - anchorBefore.y);
  const dxPopup = Math.round(pRectAfter.x - pRectBefore.x);
  const dyPopup = Math.round(pRectAfter.y - pRectBefore.y);

  const anchorFollowed = Math.abs(dxAnchor - 120) <= 2 && Math.abs(dyAnchor - 80) <= 2;
  const popupFollowed = Math.abs(dxPopup - 120) <= 2 && Math.abs(dyPopup - 80) <= 2;

  // Verify pixels at new shifted popup location
  const newCardPixel = map.readPixel(pRectAfter.x + 40, pRectAfter.y + 40);
  const isNewCardWhite = newCardPixel[0] > 240 && newCardPixel[1] > 240 && newCardPixel[2] > 240;

  // The hit-test box moved with the popup.
  const hitAfterPan = atButton(map.getButtonRect());
  emit({
    check: 'button-hit-follows-pan',
    pass: hitAfterPan === map.popupButton && atButton(bRectInitial) !== map.popupButton,
    detail: `after the pan, elementFromPoint at the new button: ${hitAfterPan?.id || hitAfterPan?.tagName}, at the old one: ${atButton(bRectInitial)?.id || atButton(bRectInitial)?.tagName}`,
  });

  emit({
    check: 'anchor-follows-pan',
    pass: anchorFollowed && popupFollowed && isNewCardWhite,
    detail: `Anchor delta: (${dxAnchor}, ${dyAnchor}), Popup delta: (${dxPopup}, ${dyPopup}), shifted card pixel: rgba(${newCardPixel.join(',')})`,
  });

  // Check 6: GSI Seamlessphoto aerial tiles loaded & rendered
  const hasTiles = await map.waitForTile(4000);
  await map.render();
  emit({
    check: 'aerial-tile-rendered',
    pass: hasTiles,
    detail: `GSI Seamlessphoto PMTiles loaded: ${hasTiles}`,
  });

  // Zooming keeps the map: two steps out put Tokyo Tower at a quarter of
  // its distance from the centre, two steps in bring it back. (The centre
  // was not rescaled on zoom, so the view left Tokyo and went blank.)
  {
    const cx = map.canvas.width / 2, cy = map.canvas.height / 2;
    const a0 = map.getAnchorPos();
    await map.zoomBy(-2);
    const a1 = map.getAnchorPos();
    await map.zoomBy(2);
    const a2 = map.getAnchorPos();
    const ex = cx + (a0.x - cx) / 4, ey = cy + (a0.y - cy) / 4;
    emit({
      check: 'zoom-keeps-the-place',
      pass: Math.hypot(a1.x - ex, a1.y - ey) < 1.5 && Math.hypot(a2.x - a0.x, a2.y - a0.y) < 1.5,
      detail: `Tokyo Tower (${a0.x.toFixed(1)}, ${a0.y.toFixed(1)}) -> zoom -2 (${a1.x.toFixed(1)}, ${a1.y.toFixed(1)}), expected (${ex.toFixed(1)}, ${ey.toFixed(1)}) -> zoom +2 (${a2.x.toFixed(1)}, ${a2.y.toFixed(1)})`,
    });
  }

  // The zoom check above left tiles to reload; time the frames with the
  // view's tiles in (or each frame skips their drawImage).
  const viewReady = await map.waitForView(6000);
  emit({ info: { view_tiles_ready_before_pan: viewReady } });

  // Pan benchmark: 60 frames. A frame is drawn in the canvas's paint event
  // (drawElementImage needs it), so redraw_ms runs from the pan to the end of
  // that frame's drawing, and frame_interval_ms is the time between the ends.
  const redrawTimes: number[] = [], frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    await map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 2);
    const t1 = performance.now();
    redrawTimes.push(t1 - t0);
    frameIntervals.push(t1 - last);
    last = t1;
  }
  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: frameIntervals });

  emit({ done: true });
}
