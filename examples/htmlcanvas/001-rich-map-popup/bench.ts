// examples/htmlcanvas/001-rich-map-popup/bench.ts
import { emit } from '../../../harness/page/bench.ts';
import type { MapPopupView } from './map.ts';

export async function runBench(map: MapPopupView, firstFrameMs: number): Promise<void> {
  const { canvas } = map;

  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // Check 1: HTML-in-Canvas native support
  emit({
    check: 'html-in-canvas-supported',
    pass: map.hasDrawElementImage,
    detail: map.hasDrawElementImage
      ? 'CanvasRenderingContext2D.prototype.drawElementImage is available'
      : 'drawElementImage is missing; running in fallback mode',
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

  // Check 4: Button interactive and state updates in canvas pixels
  await map.clickButton();
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

  // Measure frame interval during animation
  let lastTime = performance.now();
  for (let i = 0; i < 15; i++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    emit({ metric: 'frame_interval_ms', value: now - lastTime });
    lastTime = now;
  }

  // Measure redraw performance
  const samples = 20;
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    await map.render();
    const dt = performance.now() - t0;
    emit({ metric: 'redraw_ms', value: dt });
  }

  emit({ done: true });
}
