import { emit } from '../../../harness/page/bench.js';
export async function run(map, firstFrameMs) {
    const { canvas, ctx } = map;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    map.isAnimating = false;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const dpr = window.devicePixelRatio || 1;
    const rgba = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
    const mid = map.route[250];
    const midPos = map.getScreenCoords(mid[0], mid[1]);
    map.dashOffset = 0;
    map.draw();
    const linePx = rgba(midPos.x, midPos.y);
    const isBlue = linePx[0] < 80 && linePx[1] < 140 && linePx[2] > 140;
    const isDash = linePx[0] > 200 && linePx[1] > 200 && linePx[2] > 200;
    emit({
        check: 'route-line-visible',
        pass: isBlue || isDash,
        detail: `${fmt(linePx)} on the route at zoom ${map.zoom}`
    });
    const box = (size)=>Uint8ClampedArray.from(ctx.getImageData(Math.round((midPos.x - size / 2) * dpr), Math.round((midPos.y - size / 2) * dpr), Math.round(size * dpr), Math.round(size * dpr)).data);
    const before = box(36);
    map.dashOffset = 13;
    map.draw();
    const after = box(36);
    let changed = 0;
    for(let i = 0; i < before.length; i += 4){
        if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 30) changed++;
    }
    emit({
        check: 'ants-march',
        pass: changed > 30,
        detail: `${changed} px changed when the dash pattern moved 13 px`
    });
    const origin = map.getScreenCoords(map.route[0][0], map.route[0][1]);
    const originPx = rgba(origin.x, origin.y);
    emit({
        check: 'origin-marker-visible',
        pass: originPx[1] > 150 && originPx[0] < 120,
        detail: `${fmt(originPx)} at San Francisco`
    });
    const dest = map.getScreenCoords(map.route[map.route.length - 1][0], map.route[map.route.length - 1][1]);
    const destPx = rgba(dest.x, dest.y);
    emit({
        check: 'destination-marker-visible',
        pass: destPx[0] > 180 && destPx[1] < 110,
        detail: `${fmt(destPx)} at Washington D.C.`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.dashOffset = (map.dashOffset - 0.6) % 20;
        map.draw();
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
    map.panBy(30, 10);
    const anchor = map.getScreenCoords(mid[0], mid[1]);
    map.zoomAtPoint(anchor.x, anchor.y, 4.5);
    const held = map.getScreenCoords(mid[0], mid[1]);
    emit({
        check: 'wheel-zoom-keeps-point',
        pass: map.zoom === 4.5 && Math.abs(held.x - anchor.x) < 1.5 && Math.abs(held.y - anchor.y) < 1.5,
        detail: `zoom ${map.zoom}, anchor moved (${(held.x - anchor.x).toFixed(2)}, ${(held.y - anchor.y).toFixed(2)}) px`
    });
    emit({
        done: true
    });
}
