import { emit } from '../../../harness/page/bench.js';
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const BOUNDS = {
    west: -74.04728500751165,
    east: -73.91058699000139,
    south: 40.68392799015035,
    north: 40.87764500765852
};
const DEFAULT_LNG = -73.9978;
const DEFAULT_LAT = 40.7209;
const DEFAULT_ZOOM = 13;
const westMx = mercX(BOUNDS.west);
const eastMx = mercX(BOUNDS.east);
const northMy = mercY(BOUNDS.north);
const southMy = mercY(BOUNDS.south);
async function waitForBase(map, want, ms = 15000) {
    const until = performance.now() + ms;
    while(map.baseReady() < want && performance.now() < until)await sleep(50);
    return map.baseReady();
}
function distinctColours(map, step = 4) {
    const { ctx, canvas } = map;
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const seen = new Set();
    for(let y = 0; y < h; y += step){
        for(let x = 0; x < w; x += step){
            const i = (y * w + x) * 4;
            seen.add(data[i] << 16 | data[i + 1] << 8 | data[i + 2]);
        }
    }
    return seen.size;
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
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pixel = (x, y)=>ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    const patchMean = (x, y)=>{
        const data = ctx.getImageData(Math.round((x - 1) * dpr), Math.round((y - 1) * dpr), 3, 3).data;
        let r = 0, g = 0, b = 0;
        for(let i = 0; i < 9; i++){
            r += data[i * 4];
            g += data[i * 4 + 1];
            b += data[i * 4 + 2];
        }
        return [
            r / 9,
            g / 9,
            b / 9
        ];
    };
    const drag = (x0, y0, x1, y1)=>{
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: x0,
            clientY: y0,
            pointerId: 1,
            bubbles: true
        }));
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: x1,
            clientY: y1,
            pointerId: 1,
            bubbles: true
        }));
        canvas.dispatchEvent(new PointerEvent('pointerup', {
            clientX: x1,
            clientY: y1,
            pointerId: 1,
            bubbles: true
        }));
    };
    const wheel = (deltaY)=>{
        canvas.dispatchEvent(new WheelEvent('wheel', {
            clientX: width / 2,
            clientY: height / 2,
            deltaY,
            bubbles: true,
            cancelable: true
        }));
    };
    const minZoomX = Math.log2(width / (256 * (eastMx - westMx)));
    const minZoomY = Math.log2(height / (256 * (southMy - northMy)));
    const expectedMinZoom = Math.max(minZoomX, minZoomY);
    for(let t = 0; t < 300 && !map.baseLoaded(); t++)await sleep(50);
    const visible = map.baseVisible();
    const ready = await waitForBase(map, visible);
    const colours = distinctColours(map);
    emit({
        check: 'basemap-drawn',
        pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
        detail: `${ready}/${visible} tiles ready, ${colours} distinct colours in the frame`
    });
    const bay = patchMean(...map.getScreenPos(-74.025, 40.705));
    const district = patchMean(...map.getScreenPos(-74.01, 40.71));
    emit({
        check: 'basemap-shows-geography',
        pass: bay[2] > bay[0] + 20 && district[0] > 200 && district[2] <= district[0] + 15,
        detail: `Upper Bay rgb(${bay.map(Math.round).join(',')}), Financial District rgb(${district.map(Math.round).join(',')})`
    });
    const [cx0, cy0] = map.centerMercator;
    const scale0 = 256 * Math.pow(2, map.zoom);
    const hh0 = height / (2 * scale0);
    const expectedCy0 = mercY(DEFAULT_LAT) > southMy - hh0 ? southMy - hh0 : mercY(DEFAULT_LAT) < northMy + hh0 ? northMy + hh0 : mercY(DEFAULT_LAT);
    const xLocked = Math.abs(cx0 - (westMx + eastMx) / 2) < 1e-9;
    const yClamped = Math.abs(cy0 - expectedCy0) < 1e-9;
    const zoomForced = Math.abs(map.zoom - expectedMinZoom) < 1e-6;
    drag(900, 400, 100, 400);
    drag(900, 400, 100, 400);
    const [cx1] = map.centerMercator;
    const xPinned = Math.abs(cx1 - (westMx + eastMx) / 2) < 1e-9;
    const westEdge = map.getScreenPos(BOUNDS.west, DEFAULT_LAT)[0];
    const eastEdge = map.getScreenPos(BOUNDS.east, DEFAULT_LAT)[0];
    emit({
        check: 'bounds-clamped-at-min-zoom',
        pass: xLocked && yClamped && zoomForced && xPinned && Math.abs(westEdge) < 0.5 && Math.abs(eastEdge - width) < 0.5,
        detail: `zoom=${map.zoom.toFixed(6)} (bounds-fill ${expectedMinZoom.toFixed(6)}), ` + `centre mx=${cx0.toFixed(9)} my=${cy0.toFixed(9)} (limit ${expectedCy0.toFixed(9)}), ` + `x-locked=${xPinned}, bounds edges at x=${westEdge.toFixed(1)}..${eastEdge.toFixed(1)}`
    });
    map.setZoom(14.5);
    drag(800, 400, -2000, 400);
    const [cx2] = map.centerMercator;
    const scale15 = 256 * Math.pow(2, map.zoom);
    const eastLimit = eastMx - width / (2 * scale15);
    const eastEdge2 = map.getScreenPos(BOUNDS.east, map.center[1])[0];
    emit({
        check: 'drag-east-stops-at-east-bound',
        pass: Math.abs(cx2 - eastLimit) < 1e-9 && Math.abs(eastEdge2 - width) < 0.5,
        detail: `centre mx=${cx2.toFixed(9)} limit=${eastLimit.toFixed(9)}, east bound on screen x=${eastEdge2.toFixed(2)}`
    });
    drag(400, 400, 700, 400);
    const [cxA] = map.centerMercator;
    const eastEdgeA = map.getScreenPos(BOUNDS.east, map.center[1])[0];
    drag(700, 400, 400, 400);
    const [cxB] = map.centerMercator;
    const eastEdgeB = map.getScreenPos(BOUNDS.east, map.center[1])[0];
    emit({
        check: 'pan-inside-bounds-works',
        pass: Math.abs(cxA - (eastLimit - 300 / scale15)) < 1e-12 && Math.abs(eastEdgeA - (width + 300)) < 0.5 && Math.abs(cxB - eastLimit) < 1e-9 && Math.abs(eastEdgeB - width) < 0.5,
        detail: `300 px west: bound at x=${eastEdgeA.toFixed(1)} (exact ${width + 300}); ` + `back: bound at x=${eastEdgeB.toFixed(1)} (exact ${width})`
    });
    map.resetView();
    map.setZoom(14.5);
    drag(500, 100, 500, -3000);
    const [, cy3] = map.centerMercator;
    const scale3 = 256 * Math.pow(2, map.zoom);
    const southLimit = southMy - height / (2 * scale3);
    const southEdge = map.getScreenPos(map.center[0], BOUNDS.south)[1];
    emit({
        check: 'drag-south-stops-at-south-bound',
        pass: Math.abs(cy3 - southLimit) < 1e-9 && Math.abs(southEdge - height) < 0.5,
        detail: `centre my=${cy3.toFixed(9)} limit=${southLimit.toFixed(9)}, south bound on screen y=${southEdge.toFixed(2)}`
    });
    for(let i = 0; i < 10; i++)wheel(200);
    const [cx5, cy5] = map.centerMercator;
    const hw = width / (2 * 256 * Math.pow(2, map.zoom));
    const hh = height / (2 * 256 * Math.pow(2, map.zoom));
    const inside = cx5 - hw >= westMx - 1e-9 && cx5 + hw <= eastMx + 1e-9 && cy5 - hh >= northMy - 1e-9 && cy5 + hh <= southMy + 1e-9;
    emit({
        check: 'zoom-out-capped-at-bounds',
        pass: Math.abs(map.zoom - expectedMinZoom) < 1e-9 && inside && Math.abs(map.getScreenPos(BOUNDS.west, map.center[1])[0]) < 0.5 && Math.abs(map.getScreenPos(BOUNDS.east, map.center[1])[0] - width) < 0.5,
        detail: `zoom=${map.zoom.toFixed(9)} cap=${expectedMinZoom.toFixed(9)}, viewport inside bounds=${inside}`
    });
    map.resetView();
    const [cx6, cy6] = map.centerMercator;
    const scale6 = 256 * Math.pow(2, map.zoom);
    const expectedCy6 = southMy - height / (2 * scale6);
    const southEdge6 = map.getScreenPos(map.center[0], BOUNDS.south)[1];
    emit({
        check: 'reset-view-restores-constrained-camera',
        pass: Math.abs(cx6 - (westMx + eastMx) / 2) < 1e-9 && Math.abs(cy6 - expectedCy6) < 1e-9 && Math.abs(map.zoom - Math.max(DEFAULT_ZOOM, expectedMinZoom)) < 1e-9 && Math.abs(southEdge6 - height) < 0.5,
        detail: `zoom=${map.zoom.toFixed(6)}, centre mx=${cx6.toFixed(9)} my=${cy6.toFixed(9)}, ` + `south bound on screen y=${southEdge6.toFixed(2)}`
    });
    map.resetView();
    map.setZoom(14.5);
    await waitForBase(map, map.baseVisible());
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
    map.resetView();
    await waitForBase(map, map.baseVisible());
    emit({
        done: true
    });
}
