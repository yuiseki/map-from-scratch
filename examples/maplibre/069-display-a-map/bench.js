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
    const [oceanX, oceanY] = map.getScreenPos(0, 0);
    const pxOcean = ctx.getImageData(Math.round(oceanX * dpr), Math.round(oceanY * dpr), 1, 1).data;
    const isOcean = pxOcean[0] < 190 && pxOcean[1] > 190 && pxOcean[2] > 210;
    const [landX, landY] = map.getScreenPos(10, 50);
    const pxLand = ctx.getImageData(Math.round(landX * dpr), Math.round(landY * dpr), 1, 1).data;
    const isLand = pxLand[0] > 220 && pxLand[1] > 220 && pxLand[2] > 210;
    emit({
        check: 'world-map-rendered',
        pass: isOcean && isLand,
        detail: `ocean rgba(${pxOcean.join(',')}) at center, land rgba(${pxLand.join(',')}) at [10, 50]`
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
    map.setZoom(1);
    const [baseLandX, baseLandY] = map.getScreenPos(10, 50);
    map.panBy(50, 30);
    const [pannedLandX, pannedLandY] = map.getScreenPos(10, 50);
    const pxPanned = ctx.getImageData(Math.round(pannedLandX * dpr), Math.round(pannedLandY * dpr), 1, 1).data;
    const isPannedLand = pxPanned[0] > 220 && pxPanned[1] > 220 && pxPanned[2] > 210;
    emit({
        check: 'map-moves-with-pan',
        pass: isPannedLand && Math.round(pannedLandX - baseLandX) === 50 && Math.round(pannedLandY - baseLandY) === 30,
        detail: `dx=${Math.round(pannedLandX - baseLandX)}, dy=${Math.round(pannedLandY - baseLandY)}, rgba(${pxPanned.join(',')})`
    });
    map.setZoom(2);
    const [zoomLandX, zoomLandY] = map.getScreenPos(10, 50);
    const pxZoom = ctx.getImageData(Math.round(zoomLandX * dpr), Math.round(zoomLandY * dpr), 1, 1).data;
    const isZoomLand = pxZoom[0] > 220 && pxZoom[1] > 220 && pxZoom[2] > 210;
    emit({
        check: 'map-anchors-on-zoom',
        pass: isZoomLand,
        detail: `zoom=2 land pos=(${Math.round(zoomLandX)},${Math.round(zoomLandY)}), rgba(${pxZoom.join(',')})`
    });
    emit({
        done: true
    });
}
