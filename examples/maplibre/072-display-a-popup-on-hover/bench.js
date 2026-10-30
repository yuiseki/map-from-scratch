import { emit } from '../../../harness/page/bench.js';
export async function run(map, firstFrameMs) {
    const { canvas, ctx } = map;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const dpr = window.devicePixelRatio || 1;
    const rgba = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
    const isWhite = (p)=>p[0] > 245 && p[1] > 245 && p[2] > 245;
    const bubbleAt = ()=>{
        const b = map.getPopupBounds();
        return rgba(b.x + 14, b.y + 8);
    };
    const move = (x, y)=>{
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            bubbles: true
        }));
    };
    const hiddenSpot = bubbleAt();
    emit({
        check: 'popup-hidden-until-hover',
        pass: !map.popupVisible && !isWhite(hiddenSpot),
        detail: `popupVisible=${map.popupVisible}, bubble spot ${fmt(hiddenSpot)}`
    });
    const [mx, my] = map.getMarkerScreenPos();
    move(mx, my);
    const shown = bubbleAt();
    const dot = rgba(mx + 4, my);
    emit({
        check: 'hover-opens-popup',
        pass: map.popupVisible && isWhite(shown) && dot[2] > 150 && dot[0] < 80,
        detail: `marker at (${mx.toFixed(1)},${my.toFixed(1)}), bubble ${fmt(shown)}, dot ${fmt(dot)}`
    });
    move(mx + 90, my - 90);
    const away = bubbleAt();
    emit({
        check: 'pointer-leave-hides-popup',
        pass: !map.popupVisible && !isWhite(away),
        detail: `popupVisible=${map.popupVisible}, bubble spot ${fmt(away)}`
    });
    move(mx + 12, my);
    const nearVisible = map.popupVisible;
    move(mx + 16, my);
    const farHidden = !map.popupVisible;
    move(mx, my);
    emit({
        check: 'hover-radius',
        pass: nearVisible && farHidden && map.popupVisible,
        detail: `12 px -> ${nearVisible ? 'shown' : 'hidden'}, 16 px -> ${farHidden ? 'hidden' : 'shown'}`
    });
    const before = map.getPopupBounds();
    map.panBy(40, 25);
    const after = map.getPopupBounds();
    const [px, py] = map.getMarkerScreenPos();
    emit({
        check: 'popup-follows-pan',
        pass: Math.round(after.x - before.x) === 40 && Math.round(after.y - before.y) === 25 && Math.abs(after.x + after.width / 2 - px) < 0.5 && Math.abs(after.y + after.height + 8 - py) < 0.5 && isWhite(bubbleAt()),
        detail: `bubble moved (${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}) px, tip (${px.toFixed(1)},${py.toFixed(1)})`
    });
    map.zoomAtPoint(px, py, 5);
    const [zx, zy] = map.getMarkerScreenPos();
    const zoomBounds = map.getPopupBounds();
    emit({
        check: 'popup-anchors-on-zoom',
        pass: map.zoom === 5 && Math.abs(zx - px) < 1.5 && Math.abs(zy - py) < 1.5 && Math.abs(zoomBounds.x + zoomBounds.width / 2 - zx) < 0.5 && Math.abs(zoomBounds.y + zoomBounds.height + 8 - zy) < 0.5 && isWhite(bubbleAt()),
        detail: `zoom ${map.zoom}, marker moved (${(zx - px).toFixed(2)},${(zy - py).toFixed(2)}) px`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.panBy(Math.sin(i * 0.1) * 2, Math.cos(i * 0.1) * 2);
        redrawTimes.push(performance.now() - t0);
        const now = await raf();
        frameIntervals.push(now - last);
        last = now;
    }
    emit({
        metric: 'redraw_ms',
        values: redrawTimes
    });
    emit({
        metric: 'frame_interval_ms',
        values: frameIntervals
    });
    map.setZoom(3);
    const [sx, sy] = map.getMarkerScreenPos();
    move(sx, sy);
    emit({
        done: true
    });
}
