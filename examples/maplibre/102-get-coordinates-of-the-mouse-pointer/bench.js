import { emit } from '../../../harness/page/bench.js';
const CENTER = [
    -74.5,
    40
];
const OCEAN_AT = [
    -40,
    30
];
const LAND_AT = [
    -85,
    40
];
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const invMercY = (my)=>Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360 / Math.PI - 90;
const wrapLng = (lng)=>((lng + 180) % 360 + 360) % 360 - 180;
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
    const pixelAt = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p.join(',')})`;
    const isCross = (p)=>p[0] === 230 && p[1] === 57 && p[2] === 70;
    const isLand = (p)=>p[0] > 225 && p[1] > 225 && p[2] > 210;
    const isOcean = (p)=>p[0] < 190 && p[1] > 190 && p[2] > 210;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const project = (lng, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        return [
            w / 2 + (mercX(lng) - cx) * scale,
            h / 2 + (mercY(lat) - cy) * scale
        ];
    };
    const expectedLngLat = (x, y)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        const mx = cx + (x - w / 2) / scale;
        const my = Math.max(0, Math.min(1, cy + (y - h / 2) / scale));
        return [
            wrapLng(mx * 360 - 180),
            invMercY(my)
        ];
    };
    const move = (x, y)=>{
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            bubbles: true,
            cancelable: true
        }));
    };
    const initial = pixelAt(w / 2, h / 2);
    emit({
        check: 'no-readout-before-move',
        pass: map.pointer === null && !isCross(initial) && isLand(initial),
        detail: `pointer=${map.pointer === null ? 'null' : 'set'}, centre ${fmt(initial)}`
    });
    const [cx, cy] = project(CENTER[0], CENTER[1]);
    const [ox, oy] = project(OCEAN_AT[0], OCEAN_AT[1]);
    emit({
        check: 'map-rendered-at-target',
        pass: isLand(pixelAt(cx, cy)) && isOcean(pixelAt(ox, oy)),
        detail: `land ${fmt(pixelAt(cx, cy))} at centre, ocean ${fmt(pixelAt(ox, oy))} at [-40,30]`
    });
    move(700, 300);
    const exp1 = expectedLngLat(700, 300);
    const p1 = map.pointer;
    emit({
        check: 'readout-matches-projection',
        pass: p1 !== null && Math.abs(p1.lng - exp1[0]) < 1e-6 && Math.abs(p1.lat - exp1[1]) < 1e-6 && Math.round(p1.x) === 700 && Math.round(p1.y) === 300,
        detail: `readout [${p1 ? p1.lng.toFixed(5) : 'null'}, ${p1 ? p1.lat.toFixed(5) : 'null'}], expected [${exp1[0].toFixed(5)}, ${exp1[1].toFixed(5)}]`
    });
    emit({
        check: 'crosshair-drawn-at-pointer',
        pass: isCross(pixelAt(700, 300)) && isCross(pixelAt(700, 340)) && isCross(pixelAt(740, 300)),
        detail: `dot ${fmt(pixelAt(700, 300))}, vertical ${fmt(pixelAt(700, 340))}, horizontal ${fmt(pixelAt(740, 300))}`
    });
    move(ox, oy);
    const oceanPx = pixelAt(ox + 6, oy + 6);
    move(cx - 60, cy - 40);
    const landPx = pixelAt(cx - 54, cy - 34);
    emit({
        check: 'readout-matches-geography',
        pass: isOcean(oceanPx) && isLand(landPx),
        detail: `at ocean point ${fmt(oceanPx)}, at land point ${fmt(landPx)}`
    });
    move(700, 300);
    move(300, 500);
    emit({
        check: 'crosshair-clears-when-moved',
        pass: isCross(pixelAt(300, 500)) && !isCross(pixelAt(700, 300)),
        detail: `new ${fmt(pixelAt(300, 500))}, old ${fmt(pixelAt(700, 300))}`
    });
    move(500, 400);
    const before = map.pointer;
    map.panBy(100, 50);
    const exp5 = expectedLngLat(500, 400);
    const after = map.pointer;
    emit({
        check: 'readout-follows-pan',
        pass: before !== null && after !== null && Math.abs(after.lng - exp5[0]) < 1e-6 && Math.abs(after.lat - exp5[1]) < 1e-6 && Math.abs(after.lng - before.lng) > 1 && isCross(pixelAt(500, 400)),
        detail: `lng ${before ? before.lng.toFixed(3) : 'null'} -> ${after ? after.lng.toFixed(3) : 'null'}, expected ${exp5[0].toFixed(3)}, crosshair ${fmt(pixelAt(500, 400))}`
    });
    map.zoomAtPoint(500, 400, 4);
    const exp6 = expectedLngLat(500, 400);
    const zoomed = map.pointer;
    emit({
        check: 'readout-anchors-on-zoom',
        pass: map.zoom === 4 && zoomed !== null && Math.abs(zoomed.lng - exp6[0]) < 1e-6 && Math.abs(zoomed.lat - exp6[1]) < 1e-6 && Math.abs(zoomed.lng - (after ? after.lng : 0)) < 1e-9 && Math.abs(zoomed.lat - (after ? after.lat : 0)) < 1e-9 && isCross(pixelAt(500, 400)),
        detail: `zoom ${map.zoom}, readout [${zoomed ? zoomed.lng.toFixed(5) : 'null'}, ${zoomed ? zoomed.lat.toFixed(5) : 'null'}], crosshair ${fmt(pixelAt(500, 400))}`
    });
    map.resetView();
    move(500, 400);
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
    move(640, 330);
    emit({
        done: true
    });
}
