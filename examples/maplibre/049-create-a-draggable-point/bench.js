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
    const rgba = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
    const isBlue = (p)=>p[0] < 70 && p[1] > 80 && p[1] < 150 && p[2] > 170;
    const fire = (type, x, y, buttons)=>{
        canvas.dispatchEvent(new PointerEvent(type, {
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            buttons,
            bubbles: true,
            cancelable: true
        }));
    };
    const [x0, y0] = map.getPointScreenPos();
    const dot = rgba(x0 + 3, y0);
    const [lng0, lat0] = map.getPointLngLat();
    emit({
        check: 'draggable-point-visible',
        pass: isBlue(dot) && Math.abs(lng0) < 0.01 && Math.abs(lat0) < 0.01,
        detail: `${fmt(dot)} at the point (${Math.round(x0)},${Math.round(y0)}), lnglat=(${lng0.toFixed(3)},${lat0.toFixed(3)})`
    });
    fire('pointerdown', x0, y0, 1);
    const grabbed = map.isDraggingPoint();
    fire('pointermove', x0 + 80, y0 + 50, 1);
    fire('pointerup', x0 + 80, y0 + 50, 0);
    const [x1, y1] = map.getPointScreenPos();
    const afterDrag = rgba(x1 + 3, y1);
    const [lng1, lat1] = map.getPointLngLat();
    const scale = 256 * Math.pow(2, map.zoom);
    const expectLng = 80 / scale * 360;
    const my = 0.5 + 50 / scale;
    const expectLat = Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360 / Math.PI - 90;
    emit({
        check: 'point-drags-to-pointer',
        pass: grabbed && Math.round(x1 - x0) === 80 && Math.round(y1 - y0) === 50 && Math.abs(lng1 - expectLng) < 0.05 && Math.abs(lat1 - expectLat) < 0.05 && isBlue(afterDrag),
        detail: `dx=${Math.round(x1 - x0)}, dy=${Math.round(y1 - y0)}, lnglat=(${lng1.toFixed(2)},${lat1.toFixed(2)}) expected=(${expectLng.toFixed(2)},${expectLat.toFixed(2)}), ${fmt(afterDrag)}`
    });
    const [cx0, cy0] = map.center;
    emit({
        check: 'point-drag-does-not-pan',
        pass: Math.abs(cx0 - 0.5) < 1e-9 && Math.abs(cy0 - 0.5) < 1e-9,
        detail: `centre=(${cx0},${cy0}) after the pointer drag`
    });
    const [bx, by] = map.getPointScreenPos();
    fire('pointerdown', 200, 200, 1);
    fire('pointermove', 230, 220, 1);
    fire('pointerup', 230, 220, 0);
    const [cx1, cy1] = map.center;
    const [ax, ay] = map.getPointScreenPos();
    emit({
        check: 'map-pans-away-from-point',
        pass: Math.abs(cx1 - (0.5 - 30 / scale)) < 1e-9 && Math.abs(cy1 - (0.5 - 20 / scale)) < 1e-9 && Math.round(ax - bx) === 30 && Math.round(ay - by) === 20,
        detail: `centre moved to (${cx1.toFixed(6)},${cy1.toFixed(6)}), point moved (${Math.round(ax - bx)},${Math.round(ay - by)})`
    });
    const [zx, zy] = map.getPointScreenPos();
    map.zoomAtPoint(zx, zy, 3.5);
    const [wx, wy] = map.getPointScreenPos();
    emit({
        check: 'wheel-zoom-keeps-point',
        pass: map.zoom === 3.5 && Math.abs(wx - zx) < 1.5 && Math.abs(wy - zy) < 1.5,
        detail: `zoom ${map.zoom}, point moved (${(wx - zx).toFixed(2)}, ${(wy - zy).toFixed(2)}) px`
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
    map.resetView();
    emit({
        done: true
    });
}
