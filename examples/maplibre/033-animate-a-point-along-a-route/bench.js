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
    let foundRoute = false;
    let sampleRoutePx = [];
    for(let dy = -60; dy <= 60; dy++){
        const px = map.readPixel(cx, cy + dy);
        if (px[2] > 170 && px[0] > 40 && px[1] > 90) {
            foundRoute = true;
            sampleRoutePx = [
                px[0],
                px[1],
                px[2]
            ];
            break;
        }
    }
    emit({
        check: 'route-drawn',
        pass: foundRoute,
        detail: `Route line pixel: RGB(${sampleRoutePx.join(',') || 'not found'})`
    });
    const [initX, initY] = map.getMarkerScreenPos();
    const initPx = map.readPixel(Math.round(initX), Math.round(initY));
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
    const [movedX, movedY] = map.getMarkerScreenPos();
    const dist = Math.hypot(movedX - initX, movedY - initY);
    const stepCount = map.getStep();
    const movedOk = stepCount >= 60 && dist > 15;
    emit({
        check: 'point-movement',
        pass: movedOk,
        detail: `Step: ${stepCount}, marker moved by ${dist.toFixed(1)} px from (${initX.toFixed(0)}, ${initY.toFixed(0)}) to (${movedX.toFixed(0)}, ${movedY.toFixed(0)})`
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
