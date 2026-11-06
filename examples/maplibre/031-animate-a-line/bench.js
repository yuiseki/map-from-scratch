import { emit } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const canvas = map.canvas;
    const canvasOk = canvas && canvas.width > 0 && canvas.height > 0;
    emit({
        check: 'canvas-rendered',
        pass: canvasOk,
        detail: `Canvas dimensions: ${canvas.width}x${canvas.height}`
    });
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const pxCenter = map.readPixel(cx, cy);
    const landDrawn = pxCenter[0] > 200 && pxCenter[1] > 200;
    emit({
        check: 'land-drawn',
        pass: landDrawn,
        detail: `Center pixel: RGBA(${pxCenter.join(',')})`
    });
    const initialPx = map.readPixel(cx + 40, cy);
    const redrawTimes = [];
    const intervals = [];
    let lastTime = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.step();
        const t1 = performance.now();
        redrawTimes.push(t1 - t0);
        const now = performance.now();
        intervals.push(now - lastTime);
        lastTime = now;
        await new Promise((r)=>requestAnimationFrame(r));
    }
    const grownPx = map.readPixel(cx + 40, cy);
    const count = map.getPointCount();
    const lineGrew = count >= 60;
    emit({
        check: 'line-growth',
        pass: lineGrew,
        detail: `Step reached: ${count}, pixel change observed: ${initialPx.join(',')} -> ${grownPx.join(',')}`
    });
    emit({
        metric: 'redraw_ms',
        values: redrawTimes
    });
    emit({
        metric: 'frame_interval_ms',
        values: intervals
    });
    emit({
        done: true
    });
}
