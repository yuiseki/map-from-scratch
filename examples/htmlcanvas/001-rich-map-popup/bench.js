import { emit } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    const { canvas } = map;
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        check: 'html-in-canvas-supported',
        pass: map.hasDrawElementImage,
        detail: map.hasDrawElementImage ? 'CanvasRenderingContext2D.prototype.drawElementImage is available' : 'drawElementImage is missing; running in fallback mode'
    });
    emit({
        check: 'landmarks-loaded',
        pass: map.landmarks.length === 5,
        detail: `Loaded ${map.landmarks.length} Tokyo landmarks (expected 5)`
    });
    const pRectInitial = map.getPopupRect();
    const bRectInitial = map.getButtonRect();
    const cardPixel = map.readPixel(pRectInitial.x + 40, pRectInitial.y + 40);
    const isCardWhite = cardPixel[0] > 240 && cardPixel[1] > 240 && cardPixel[2] > 240;
    const btnPixel = map.readPixel(bRectInitial.x + bRectInitial.width / 2, bRectInitial.y + bRectInitial.height / 2);
    const isBtnBlue = btnPixel[2] > 200 && btnPixel[0] < 80;
    emit({
        check: 'popup-rendered-on-canvas',
        pass: isCardWhite && isBtnBlue,
        detail: `Popup card pixel: rgba(${cardPixel.join(',')}), Button pixel: rgba(${btnPixel.join(',')})`
    });
    await map.clickButton();
    const btnPixelActive = map.readPixel(bRectInitial.x + bRectInitial.width / 2, bRectInitial.y + bRectInitial.height / 2);
    const isBtnGreen = btnPixelActive[1] > 140 && btnPixelActive[0] < 50;
    emit({
        check: 'button-interactive',
        pass: map.bookmarked && isBtnGreen,
        detail: `Bookmarked: ${map.bookmarked}, Active button pixel: rgba(${btnPixelActive.join(',')})`
    });
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
    const newCardPixel = map.readPixel(pRectAfter.x + 40, pRectAfter.y + 40);
    const isNewCardWhite = newCardPixel[0] > 240 && newCardPixel[1] > 240 && newCardPixel[2] > 240;
    emit({
        check: 'anchor-follows-pan',
        pass: anchorFollowed && popupFollowed && isNewCardWhite,
        detail: `Anchor delta: (${dxAnchor}, ${dyAnchor}), Popup delta: (${dxPopup}, ${dyPopup}), shifted card pixel: rgba(${newCardPixel.join(',')})`
    });
    const hasTiles = await map.waitForTile(4000);
    await map.render();
    emit({
        check: 'aerial-tile-rendered',
        pass: hasTiles,
        detail: `GSI Seamlessphoto PMTiles loaded: ${hasTiles}`
    });
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
            detail: `Tokyo Tower (${a0.x.toFixed(1)}, ${a0.y.toFixed(1)}) -> zoom -2 (${a1.x.toFixed(1)}, ${a1.y.toFixed(1)}), expected (${ex.toFixed(1)}, ${ey.toFixed(1)}) -> zoom +2 (${a2.x.toFixed(1)}, ${a2.y.toFixed(1)})`
        });
    }
    let lastTime = performance.now();
    for(let i = 0; i < 15; i++){
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        emit({
            metric: 'frame_interval_ms',
            value: now - lastTime
        });
        lastTime = now;
    }
    const samples = 20;
    for(let i = 0; i < samples; i++){
        const t0 = performance.now();
        await map.render();
        const dt = performance.now() - t0;
        emit({
            metric: 'redraw_ms',
            value: dt
        });
    }
    emit({
        done: true
    });
}
