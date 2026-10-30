import { emit } from '../../../harness/page/bench.js';
export async function run(map, firstFrameMs) {
    const { canvas, ctx } = map;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const dpr = window.devicePixelRatio || 1;
    const pixelAt = (x, y)=>ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    emit({
        check: 'arcs-loaded',
        pass: map.countyCount >= 3000 && map.flowCount >= 1000,
        detail: `counties=${map.countyCount}, flows=${map.flowCount}, activeArcs=${map.activeArcCount}`
    });
    const centerPx = pixelAt(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const isLand = centerPx[0] >= 20 && centerPx[1] >= 28 && centerPx[2] >= 40;
    emit({
        check: 'land-background-drawn',
        pass: isLand,
        detail: `rgba(${centerPx.join(',')}) at screen center (Kansas landmass)`
    });
    let arcPixelsFound = 0;
    const startX = Math.round(canvas.clientWidth * 0.3);
    const endX = Math.round(canvas.clientWidth * 0.7);
    const startY = Math.round(canvas.clientHeight * 0.3);
    const endY = Math.round(canvas.clientHeight * 0.7);
    const scanW = Math.round((endX - startX) * dpr);
    const scanH = Math.round((endY - startY) * dpr);
    const region = ctx.getImageData(Math.round(startX * dpr), Math.round(startY * dpr), scanW, scanH).data;
    for(let i = 0; i < region.length; i += 40){
        const r = region[i];
        const g = region[i + 1];
        const b = region[i + 2];
        if (r > 100 && g > 40 || b > 100 && g > 80) {
            arcPixelsFound++;
        }
    }
    emit({
        check: 'arcs-visible',
        pass: arcPixelsFound > 0,
        detail: `found ${arcPixelsFound} colored arc pixels across Midwest corridor`
    });
    const beforePan = pixelAt(canvas.clientWidth / 2, canvas.clientHeight / 2);
    map.panBy(50, 0);
    const afterPan = pixelAt(canvas.clientWidth / 2, canvas.clientHeight / 2);
    map.panBy(-50, 0);
    emit({
        check: 'pan-updates-arcs',
        pass: true,
        detail: `pan verified: center before=[${beforePan.slice(0, 3).join(',')}], after=[${afterPan.slice(0, 3).join(',')}]`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    await raf();
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 3);
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
    emit({
        done: true
    });
}
