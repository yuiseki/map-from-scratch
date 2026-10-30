import { emit } from '../../../harness/page/bench.js';
function readPixel(ctx, x, y, dpr) {
    const img = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1);
    return [
        img.data[0],
        img.data[1],
        img.data[2],
        img.data[3]
    ];
}
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
    map.setLayer('osm');
    const oceanPos = map.getScreenCoords(0, 0);
    const landPos = map.getScreenCoords(10, 50);
    const pxOsmOcean = readPixel(ctx, oceanPos.x, oceanPos.y, dpr);
    const isOsmOcean = pxOsmOcean[0] < 190 && pxOsmOcean[1] > 190 && pxOsmOcean[2] > 210;
    const pxOsmLand = readPixel(ctx, landPos.x, landPos.y, dpr);
    const isOsmLand = pxOsmLand[0] > 220 && pxOsmLand[1] > 220 && pxOsmLand[2] > 210;
    map.setLayer('satellite');
    const pxSatOcean = readPixel(ctx, oceanPos.x, oceanPos.y, dpr);
    const isSatOcean = pxSatOcean[0] < 30 && pxSatOcean[1] < 50 && pxSatOcean[2] < 80;
    const pxSatLand = readPixel(ctx, landPos.x, landPos.y, dpr);
    const isSatLand = pxSatLand[0] < 60 && pxSatLand[1] > 60 && pxSatLand[1] < 100 && pxSatLand[2] < 60;
    emit({
        check: 'layer-switching-updates-pixels',
        pass: isOsmOcean && isOsmLand && isSatOcean && isSatLand,
        detail: `OSM (ocean:${pxOsmOcean.slice(0, 3)}, land:${pxOsmLand.slice(0, 3)}) -> SAT (ocean:${pxSatOcean.slice(0, 3)}, land:${pxSatLand.slice(0, 3)})`
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
    map.center = {
        lon: 0,
        lat: 20
    };
    map.draw();
    const baseLand = map.getScreenCoords(10, 50);
    map.panBy(50, 30);
    const pannedLand = map.getScreenCoords(10, 50);
    const pxPannedSat = readPixel(ctx, pannedLand.x, pannedLand.y, dpr);
    const isPannedSat = pxPannedSat[0] < 60 && pxPannedSat[1] > 60 && pxPannedSat[1] < 100 && pxPannedSat[2] < 60;
    emit({
        check: 'pan-preserves-layer-state',
        pass: isPannedSat && Math.round(pannedLand.x - baseLand.x) === 50 && Math.round(pannedLand.y - baseLand.y) === 30,
        detail: `dx=${Math.round(pannedLand.x - baseLand.x)}, dy=${Math.round(pannedLand.y - baseLand.y)}, rgba(${pxPannedSat.join(',')})`
    });
    map.setZoom(2);
    const zoomLand = map.getScreenCoords(10, 50);
    const pxZoomSat = readPixel(ctx, zoomLand.x, zoomLand.y, dpr);
    const isZoomSat = pxZoomSat[0] < 60 && pxZoomSat[1] > 60 && pxZoomSat[1] < 100 && pxZoomSat[2] < 60;
    emit({
        check: 'zoom-preserves-layer-state',
        pass: isZoomSat,
        detail: `zoom=2 land pos=(${Math.round(zoomLand.x)}, ${Math.round(zoomLand.y)}), rgba(${pxZoomSat.join(',')})`
    });
    emit({
        done: true
    });
}
