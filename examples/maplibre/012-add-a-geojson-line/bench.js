import { emit } from '../../../harness/page/bench.js';
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
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
    const pixel = (x, y)=>ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    for(let t = 0; t < 300 && !map.baseLoaded(); t++)await sleep(50);
    const visible = map.baseVisible();
    const ready = await waitForBase(map, visible);
    const colours = distinctColours(map);
    emit({
        check: 'basemap-drawn',
        pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
        detail: `${ready}/${visible} tiles ready, ${colours} distinct colours in the frame`
    });
    map.setBaseVisible(false);
    map.draw();
    const testLng = -122.48610019683838;
    const testLat = 37.82880236636284;
    const [sx0, sy0] = map.getScreenPos(testLng, testLat);
    const px0 = pixel(sx0, sy0);
    const isGray0 = Math.abs(px0[0] - 136) < 20 && Math.abs(px0[1] - 136) < 20 && Math.abs(px0[2] - 136) < 20;
    emit({
        check: 'line-rendered-gray',
        pass: isGray0,
        detail: `rgba(${px0[0]},${px0[1]},${px0[2]},${px0[3]}) at (${Math.round(sx0)},${Math.round(sy0)})`
    });
    map.setZoom(15);
    const [baseX, baseY] = map.getScreenPos(testLng, testLat);
    map.panBy(60, 40);
    const [pannedX, pannedY] = map.getScreenPos(testLng, testLat);
    const pxPan = pixel(pannedX, pannedY);
    const isGrayPan = Math.abs(pxPan[0] - 136) < 20 && Math.abs(pxPan[1] - 136) < 20 && Math.abs(pxPan[2] - 136) < 20;
    emit({
        check: 'line-moves-with-pan',
        pass: isGrayPan && Math.round(pannedX - baseX) === 60 && Math.round(pannedY - baseY) === 40,
        detail: `dx=${Math.round(pannedX - baseX)}, dy=${Math.round(pannedY - baseY)}, rgba(${pxPan[0]},${pxPan[1]},${pxPan[2]},${pxPan[3]})`
    });
    map.setLineStyle('#3887be', 12);
    const pxStyled = pixel(pannedX, pannedY);
    const isBlue = pxStyled[0] < 80 && pxStyled[1] > 110 && pxStyled[2] > 160;
    emit({
        check: 'line-restyled',
        pass: isBlue,
        detail: `rgba(${pxStyled[0]},${pxStyled[1]},${pxStyled[2]},${pxStyled[3]}) after setLineStyle('#3887be', 12)`
    });
    map.setZoom(16);
    const [zoomX, zoomY] = map.getScreenPos(testLng, testLat);
    const pxZoom = pixel(zoomX, zoomY);
    const isBlueZoom = pxZoom[0] < 80 && pxZoom[1] > 110 && pxZoom[2] > 160;
    emit({
        check: 'line-anchors-on-zoom',
        pass: isBlueZoom,
        detail: `zoom=16 pos=(${Math.round(zoomX)},${Math.round(zoomY)}), rgba(${pxZoom[0]},${pxZoom[1]},${pxZoom[2]},${pxZoom[3]})`
    });
    map.setBaseVisible(true);
    map.resetView();
    map.setLineStyle('#888888', 8);
    await waitForBase(map, 8);
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
    await waitForBase(map, 8);
    emit({
        done: true
    });
}
