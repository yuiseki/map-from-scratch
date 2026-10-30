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
    const same = (a, b)=>a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    const wheel = (x, y)=>{
        canvas.dispatchEvent(new WheelEvent('wheel', {
            clientX: x,
            clientY: y,
            deltaY: -120,
            bubbles: true,
            cancelable: true
        }));
    };
    const before = map.center;
    const viewportBefore = rgba(700, 300);
    wheel(700, 300);
    wheel(700, 300);
    const after = map.center;
    const viewportAfter = rgba(700, 300);
    emit({
        check: 'wheel-does-not-zoom',
        pass: map.zoom === 3 && before[0] === after[0] && before[1] === after[1] && same(viewportBefore, viewportAfter),
        detail: `zoom ${map.zoom}, pixel ${fmt(viewportBefore)} -> ${fmt(viewportAfter)}`
    });
    const anchorLng = (()=>{
        const scale = 256 * Math.pow(2, map.zoom);
        return ((700 - canvas.clientWidth / 2) / scale + before[0]) * 360 - 180;
    })();
    const anchorLat = (()=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const my = (300 - canvas.clientHeight / 2) / scale + before[1];
        return Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360 / Math.PI - 90;
    })();
    canvas.dispatchEvent(new MouseEvent('dblclick', {
        clientX: 700,
        clientY: 300,
        bubbles: true,
        cancelable: true
    }));
    const [ax, ay] = map.getScreenPos(anchorLng, anchorLat);
    emit({
        check: 'double-click-zooms',
        pass: map.zoom === 4 && Math.abs(ax - 700) < 1.5 && Math.abs(ay - 300) < 1.5,
        detail: `zoom ${map.zoom}, anchor at (${ax.toFixed(2)},${ay.toFixed(2)})`
    });
    const zoomBefore = map.zoom;
    const centreBefore = map.center;
    wheel(500, 400);
    emit({
        check: 'wheel-stays-disabled',
        pass: map.zoom === zoomBefore && map.center[0] === centreBefore[0] && map.center[1] === centreBefore[1],
        detail: `zoom ${map.zoom} after wheel at (500,400)`
    });
    const [gx0, gy0] = map.getScreenPos(-96, 37.8);
    const [cx0, cy0] = map.center;
    const scale = 256 * Math.pow(2, map.zoom);
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 200,
        clientY: 600,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        bubbles: true
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 240,
        clientY: 620,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        bubbles: true
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 240,
        clientY: 620,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        bubbles: true
    }));
    const [gx1, gy1] = map.getScreenPos(-96, 37.8);
    const [cx1, cy1] = map.center;
    emit({
        check: 'drag-still-pans',
        pass: Math.abs(cx1 - (cx0 - 40 / scale)) < 1e-9 && Math.abs(cy1 - (cy0 - 20 / scale)) < 1e-9 && Math.round(gx1 - gx0) === 40 && Math.round(gy1 - gy0) === 20,
        detail: `centre moved ${((cx1 - cx0) * scale).toFixed(1)},${((cy1 - cy0) * scale).toFixed(1)} px`
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
    emit({
        done: true
    });
}
