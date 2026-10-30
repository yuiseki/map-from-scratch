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
    const posHot = map.getScreenCoords(-150, 60);
    const pxHot = ctx.getImageData(Math.round(posHot.x * dpr), Math.round(posHot.y * dpr), 1, 1).data;
    const isHot = pxHot[0] > 100 || pxHot[1] > 60 || pxHot[2] > 120;
    emit({
        check: 'heatmap-density-rendered',
        pass: isHot,
        detail: `alaska trench pos=(${Math.round(posHot.x)}, ${Math.round(posHot.y)}) rgba(${pxHot.join(',')})`
    });
    const posOcean = map.getScreenCoords(-140, 20);
    const pxOcean = ctx.getImageData(Math.round(posOcean.x * dpr), Math.round(posOcean.y * dpr), 1, 1).data;
    const isOcean = pxOcean[0] < 35 && pxOcean[1] < 45 && pxOcean[2] < 65;
    emit({
        check: 'ocean-background-preserved',
        pass: isOcean,
        detail: `open ocean pos=(${Math.round(posOcean.x)}, ${Math.round(posOcean.y)}) rgba(${pxOcean.join(',')}) expected dark ocean #0b1326`
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
    map.center = {
        lon: -130,
        lat: 45
    };
    map.setZoom(2.5);
    map.draw();
    map.panBy(60, 40);
    const pannedTargetX = Math.round((posHot.x + 60) * dpr);
    const pannedTargetY = Math.round((posHot.y + 40) * dpr);
    const pxPanned = ctx.getImageData(pannedTargetX, pannedTargetY, 1, 1).data;
    const isPannedHot = pxPanned[0] > 100 || pxPanned[1] > 60 || pxPanned[2] > 120;
    emit({
        check: 'heatmap-moves-with-pan',
        pass: isPannedHot,
        detail: `panned hotspot (${pannedTargetX}, ${pannedTargetY}) rgba(${pxPanned.join(',')})`
    });
    emit({
        done: true
    });
}
const mapInstance = window.__map;
if (mapInstance) {
    void run(mapInstance, performance.now());
}
