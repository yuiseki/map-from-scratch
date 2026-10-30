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
    const testLng = -69.0;
    const testLat = 45.0;
    const [sx0, sy0] = map.getScreenPos(testLng, testLat);
    const px0 = ctx.getImageData(Math.round(sx0 * dpr), Math.round(sy0 * dpr), 1, 1).data;
    const isTeal0 = px0[0] < 75 && px0[1] > 130 && px0[2] > 130;
    emit({
        check: 'polygon-filled-teal',
        pass: isTeal0,
        detail: `rgba(${px0[0]},${px0[1]},${px0[2]},${px0[3]}) at (${Math.round(sx0)},${Math.round(sy0)})`
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
    map.setZoom(5);
    const [baseX, baseY] = map.getScreenPos(testLng, testLat);
    map.panBy(50, 30);
    const [pannedX, pannedY] = map.getScreenPos(testLng, testLat);
    const pxPan = ctx.getImageData(Math.round(pannedX * dpr), Math.round(pannedY * dpr), 1, 1).data;
    const isTealPan = pxPan[0] < 75 && pxPan[1] > 130 && pxPan[2] > 130;
    emit({
        check: 'polygon-moves-with-pan',
        pass: isTealPan && Math.round(pannedX - baseX) === 50 && Math.round(pannedY - baseY) === 30,
        detail: `dx=${Math.round(pannedX - baseX)}, dy=${Math.round(pannedY - baseY)}, rgba(${pxPan[0]},${pxPan[1]},${pxPan[2]},${pxPan[3]})`
    });
    map.setPolygonStyle('#ff8800', 0.9);
    const pxStyled = ctx.getImageData(Math.round(pannedX * dpr), Math.round(pannedY * dpr), 1, 1).data;
    const isOrange = pxStyled[0] > 200 && pxStyled[1] > 100 && pxStyled[2] < 80;
    emit({
        check: 'polygon-restyled',
        pass: isOrange,
        detail: `rgba(${pxStyled[0]},${pxStyled[1]},${pxStyled[2]},${pxStyled[3]}) after setPolygonStyle('#ff8800', 0.9)`
    });
    map.setZoom(6);
    const [zoomX, zoomY] = map.getScreenPos(testLng, testLat);
    const pxZoom = ctx.getImageData(Math.round(zoomX * dpr), Math.round(zoomY * dpr), 1, 1).data;
    const isOrangeZoom = pxZoom[0] > 200 && pxZoom[1] > 100 && pxZoom[2] < 80;
    emit({
        check: 'polygon-anchors-on-zoom',
        pass: isOrangeZoom,
        detail: `zoom=6 pos=(${Math.round(zoomX)},${Math.round(zoomY)}), rgba(${pxZoom[0]},${pxZoom[1]},${pxZoom[2]},${pxZoom[3]})`
    });
    emit({
        done: true
    });
}
