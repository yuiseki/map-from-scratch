import { emit } from '../../../harness/page/bench.js';
const TEAL = [
    0,
    136,
    136
];
const ORANGE = [
    255,
    136,
    0
];
const CENTER_LNG = 37.5;
const CENTER_LAT = 7.5;
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
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
    const fmt = (p)=>`rgb(${p[0]},${p[1]},${p[2]})`;
    const near = (p, q)=>Math.abs(p[0] - q[0]) <= 2 && Math.abs(p[1] - q[1]) <= 2 && Math.abs(p[2] - q[2]) <= 2;
    const screenPos = (lon, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const c = map.center;
        return [
            canvas.clientWidth / 2 + (mercX(lon) - c[0]) * scale,
            canvas.clientHeight / 2 + (mercY(lat) - c[1]) * scale
        ];
    };
    const sample = ()=>rgba(...screenPos(CENTER_LNG, CENTER_LAT));
    const move = (x, y)=>{
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            buttons: 0,
            bubbles: true
        }));
    };
    const leave = ()=>{
        canvas.dispatchEvent(new PointerEvent('pointerleave', {
            pointerId: 1,
            pointerType: 'mouse',
            bubbles: true
        }));
    };
    emit({
        check: 'default-fill-teal',
        pass: !map.hovering && near(sample(), TEAL),
        detail: `${fmt(sample())}, hovering=${map.hovering}`
    });
    const [cx, cy] = screenPos(CENTER_LNG, CENTER_LAT);
    move(cx, cy);
    emit({
        check: 'hover-highlights-polygon',
        pass: map.hovering && near(sample(), ORANGE),
        detail: `at (${Math.round(cx)},${Math.round(cy)}): ${fmt(sample())}, hovering=${map.hovering}`
    });
    leave();
    emit({
        check: 'leave-restores-fill',
        pass: !map.hovering && near(sample(), TEAL),
        detail: `${fmt(sample())}, hovering=${map.hovering}`
    });
    map.panBy(60, 40);
    const [px, py] = screenPos(CENTER_LNG, CENTER_LAT);
    move(px, py);
    emit({
        check: 'hover-follows-pan',
        pass: map.hovering && near(sample(), ORANGE),
        detail: `after (60,40) pan at (${Math.round(px)},${Math.round(py)}): ${fmt(sample())}`
    });
    leave();
    map.setZoom(5);
    const [zx, zy] = screenPos(CENTER_LNG, CENTER_LAT);
    move(zx, zy);
    emit({
        check: 'hover-anchors-on-zoom',
        pass: map.zoom === 5 && map.hovering && near(sample(), ORANGE),
        detail: `zoom ${map.zoom} at (${Math.round(zx)},${Math.round(zy)}): ${fmt(sample())}`
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
