import { emit } from '../../../harness/page/bench.js';
const LANDMARK = [
    -95,
    40
];
const OCEAN_POINT = [
    -60,
    30
];
const ACCENT = [
    42,
    122,
    226
];
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
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
    const is = (p, rgb)=>p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2];
    const isLand = (p)=>p[0] > 225 && p[1] > 225 && p[2] > 210;
    const isOcean = (p)=>p[0] < 190 && p[1] > 195 && p[2] > 205;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const project = (lon, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        return [
            w / 2 + (mercX(lon) - cx) * scale,
            h / 2 + (mercY(lat) - cy) * scale
        ];
    };
    const camera = ()=>[
            map.center[0],
            map.center[1]
        ];
    const pointer = (type, x, y)=>{
        canvas.dispatchEvent(new PointerEvent(type, {
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            bubbles: true,
            buttons: type === 'pointerup' ? 0 : 1
        }));
    };
    const drag = (x, y, dx, dy)=>{
        pointer('pointerdown', x, y);
        pointer('pointermove', x + dx / 2, y + dy / 2);
        pointer('pointermove', x + dx, y + dy);
        pointer('pointerup', x + dx, y + dy);
    };
    const wheel = (x, y, deltaY)=>{
        canvas.dispatchEvent(new WheelEvent('wheel', {
            clientX: x,
            clientY: y,
            deltaY,
            bubbles: true,
            cancelable: true
        }));
    };
    const dblclick = (x, y)=>{
        canvas.dispatchEvent(new MouseEvent('dblclick', {
            clientX: x,
            clientY: y,
            bubbles: true
        }));
    };
    const clickRow = (i)=>{
        const r = map.getRowRect(i);
        pointer('pointerdown', r.x + r.width / 2, r.y + r.height / 2);
        pointer('pointerup', r.x + r.width / 2, r.y + r.height / 2);
    };
    const tickAt = (i)=>{
        const b = map.getCheckboxRect(i);
        return pixelAt(b.x + 12, b.y + 12);
    };
    const darkPixels = (x, y, cw, ch)=>{
        const data = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(cw * dpr), Math.round(ch * dpr)).data;
        let n = 0;
        for(let i = 0; i < data.length; i += 4){
            if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) n++;
        }
        return n;
    };
    const panel = map.getPanelRect();
    const ticks = [
        0,
        1,
        2
    ].map(tickAt);
    const labelDark = [
        0,
        1,
        2
    ].map((i)=>{
        const r = map.getRowRect(i);
        return darkPixels(r.x + 34, r.y + 4, 150, r.height - 8);
    });
    emit({
        check: 'controls-visible',
        pass: ticks.every((p)=>is(p, ACCENT)) && labelDark.every((n)=>n > 20),
        detail: `panel (${panel.x},${panel.y},${panel.width},${panel.height}), ticks ` + `${ticks.map(fmt).join(' ')}, label dark px ${labelDark.join('/')}`
    });
    const centre = pixelAt(w / 2, h / 2);
    const ocean = project(OCEAN_POINT[0], OCEAN_POINT[1]);
    const oceanPx = pixelAt(ocean[0], ocean[1]);
    emit({
        check: 'map-rendered-at-target',
        pass: map.zoom === 3 && isLand(centre) && isOcean(oceanPx),
        detail: `zoom ${map.zoom}, centre ${fmt(centre)}, ocean ${fmt(oceanPx)}`
    });
    const lmBefore = project(LANDMARK[0], LANDMARK[1]);
    const camBefore = camera();
    drag(700, 400, 120, 60);
    const lmAfter = project(LANDMARK[0], LANDMARK[1]);
    const camAfter = camera();
    const scale0 = 256 * Math.pow(2, 3);
    emit({
        check: 'drag-pans-by-default',
        pass: Math.abs(lmAfter[0] - lmBefore[0] - 120) < 1e-6 && Math.abs(lmAfter[1] - lmBefore[1] - 60) < 1e-6 && Math.abs(camAfter[0] - (camBefore[0] - 120 / scale0)) < 1e-12 && Math.abs(camAfter[1] - (camBefore[1] - 60 / scale0)) < 1e-12,
        detail: `landmark (${lmBefore[0].toFixed(1)},${lmBefore[1].toFixed(1)}) -> ` + `(${lmAfter[0].toFixed(1)},${lmAfter[1].toFixed(1)})`
    });
    map.resetView();
    clickRow(0);
    const offTick = tickAt(0);
    const lmStill = project(LANDMARK[0], LANDMARK[1]);
    const camStill = camera();
    drag(700, 400, 150, 60);
    const lmStillAfter = project(LANDMARK[0], LANDMARK[1]);
    const camStillAfter = camera();
    emit({
        check: 'drag-disabled-stops-pan',
        pass: map.toggles.dragPan === false && offTick[0] > 245 && offTick[1] > 245 && offTick[2] > 245 && camStillAfter[0] === camStill[0] && camStillAfter[1] === camStill[1] && Math.abs(lmStillAfter[0] - lmStill[0]) < 1e-9 && Math.abs(lmStillAfter[1] - lmStill[1]) < 1e-9,
        detail: `dragPan=${map.toggles.dragPan}, tick ${fmt(offTick)}, ` + `camera ${camStill[0].toFixed(9)},${camStill[1].toFixed(9)} unchanged`
    });
    clickRow(0);
    const onTick = tickAt(0);
    drag(700, 400, 80, 40);
    emit({
        check: 'drag-reenabled-works',
        pass: map.toggles.dragPan === true && is(onTick, ACCENT) && Math.abs(camera()[0] - (camStill[0] - 80 / scale0)) < 1e-12 && Math.abs(camera()[1] - (camStill[1] - 40 / scale0)) < 1e-12,
        detail: `tick ${fmt(onTick)}, camera moved by (80,40) px`
    });
    map.resetView();
    const zoomStart = map.zoom;
    const lmWheel = project(LANDMARK[0], LANDMARK[1]);
    const cursor = [
        500,
        400
    ];
    const k = Math.pow(2, 0.5);
    wheel(cursor[0], cursor[1], -100);
    const lmZoomed = project(LANDMARK[0], LANDMARK[1]);
    emit({
        check: 'scroll-zooms-by-default',
        pass: Math.abs(map.zoom - (zoomStart + 0.5)) < 1e-12 && Math.abs(lmZoomed[0] - cursor[0] - (lmWheel[0] - cursor[0]) * k) < 1e-6 && Math.abs(lmZoomed[1] - cursor[1] - (lmWheel[1] - cursor[1]) * k) < 1e-6,
        detail: `zoom ${zoomStart} -> ${map.zoom}, landmark ${lmWheel[0].toFixed(1)} -> ${lmZoomed[0].toFixed(1)}`
    });
    clickRow(1);
    const zoomHeld = map.zoom;
    wheel(cursor[0], cursor[1], -100);
    const lmHeld = project(LANDMARK[0], LANDMARK[1]);
    emit({
        check: 'scroll-disabled-stops-zoom',
        pass: map.toggles.scrollZoom === false && map.zoom === zoomHeld && Math.abs(lmHeld[0] - lmZoomed[0]) < 1e-9 && Math.abs(lmHeld[1] - lmZoomed[1]) < 1e-9,
        detail: `zoom stays ${map.zoom}, landmark ${fmt(pixelAt(lmHeld[0], lmHeld[1]))}`
    });
    map.resetView();
    const lmDbl = project(LANDMARK[0], LANDMARK[1]);
    dblclick(cursor[0], cursor[1]);
    const lmDblAfter = project(LANDMARK[0], LANDMARK[1]);
    emit({
        check: 'dblclick-zooms-by-default',
        pass: map.zoom === 4 && Math.abs(lmDblAfter[0] - cursor[0] - (lmDbl[0] - cursor[0]) * 2) < 1e-6 && Math.abs(lmDblAfter[1] - cursor[1] - (lmDbl[1] - cursor[1]) * 2) < 1e-6,
        detail: `zoom ${map.zoom}, landmark ${lmDbl[1].toFixed(1)} -> ${lmDblAfter[1].toFixed(1)}`
    });
    clickRow(2);
    const zoomDblHeld = map.zoom;
    dblclick(cursor[0], cursor[1]);
    emit({
        check: 'dblclick-disabled-stops-zoom',
        pass: map.toggles.dblClickZoom === false && map.zoom === zoomDblHeld,
        detail: `dblClickZoom=${map.toggles.dblClickZoom}, zoom stays ${map.zoom}`
    });
    map.resetView();
    const resetTicks = [
        0,
        1,
        2
    ].map(tickAt);
    emit({
        check: 'reset-restores-controls',
        pass: map.zoom === 3 && map.toggles.dragPan && map.toggles.scrollZoom && map.toggles.dblClickZoom && resetTicks.every((p)=>is(p, ACCENT)),
        detail: `zoom ${map.zoom}, ticks ${resetTicks.map(fmt).join(' ')}`
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
    await sleep(50);
    emit({
        done: true
    });
}
