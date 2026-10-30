import { emit } from '../../../harness/page/bench.js';
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const OVERLAY = {
    west: -88.4,
    east: -86.85,
    south: 41.45,
    north: 42.15
};
const IMAGE = 256;
const CELL = 32;
const COLOUR_A = [
    37,
    99,
    235
];
const COLOUR_B = [
    14,
    165,
    233
];
const imgPixel = (lon, lat)=>{
    const x = Math.floor((lon - OVERLAY.west) / (OVERLAY.east - OVERLAY.west) * IMAGE);
    const y = Math.floor((OVERLAY.north - lat) / (OVERLAY.north - OVERLAY.south) * IMAGE);
    const rgb = (Math.floor(x / CELL) + Math.floor(y / CELL)) % 2 === 0 ? COLOUR_A : COLOUR_B;
    return {
        x,
        y,
        rgb
    };
};
const blend = (base, rgb, alpha)=>[
        0,
        1,
        2
    ].map((i)=>Math.round(rgb[i] * alpha + base[i] * (1 - alpha)));
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
    const same = (px, expected, tol)=>[
            0,
            1,
            2
        ].every((i)=>Math.abs(px[i] - expected[i]) <= tol);
    const fmt = (px)=>`rgb(${px[0]},${px[1]},${px[2]})`;
    const insideA = [
        -87.9,
        41.95
    ];
    const insideB = [
        -87.2,
        41.7
    ];
    const outsideLeft = [
        -88.6,
        41.9
    ];
    const outsideRight = [
        -86.7,
        41.9
    ];
    const outsideBottom = [
        -87.6,
        41.35
    ];
    const screenA = map.getScreenPos(...insideA);
    const screenB = map.getScreenPos(...insideB);
    const screenL = map.getScreenPos(...outsideLeft);
    const screenR = map.getScreenPos(...outsideRight);
    const screenBot = map.getScreenPos(...outsideBottom);
    const cellA = imgPixel(...insideA);
    const cellB = imgPixel(...insideB);
    map.setOpacity(0);
    for(let t = 0; t < 300 && !map.baseLoaded(); t++)await sleep(50);
    const visible = map.baseVisible();
    const ready = await waitForBase(map, visible);
    const colours = distinctColours(map);
    emit({
        check: 'basemap-drawn',
        pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
        detail: `${ready}/${visible} tiles ready, ${colours} distinct colours at 0% opacity`
    });
    const baseA = Array.from(pixel(...screenA));
    const baseB = Array.from(pixel(...screenB));
    const baseL = Array.from(pixel(...screenL));
    const baseR = Array.from(pixel(...screenR));
    const baseBot = Array.from(pixel(...screenBot));
    map.setOpacity(100);
    const fullA = pixel(...screenA);
    const fullB = pixel(...screenB);
    emit({
        check: 'overlay-rendered-at-full-opacity',
        pass: same(fullA, cellA.rgb, 2) && same(fullB, cellB.rgb, 2),
        detail: `A cell(${cellA.x},${cellA.y}) expected rgb(${cellA.rgb.join(',')}) got ${fmt(fullA)}; ` + `B cell(${cellB.x},${cellB.y}) expected rgb(${cellB.rgb.join(',')}) got ${fmt(fullB)}`
    });
    const outL = pixel(...screenL);
    const outR = pixel(...screenR);
    const outBot = pixel(...screenBot);
    emit({
        check: 'overlay-clipped-to-bounds',
        pass: same(outL, baseL, 1) && same(outR, baseR, 1) && same(outBot, baseBot, 1),
        detail: `outside left ${fmt(outL)} base ${fmt(baseL)}; right ${fmt(outR)}/${fmt(baseR)}; ` + `bottom ${fmt(outBot)}/${fmt(baseBot)}`
    });
    map.setOpacity(50);
    const halfA = Array.from(pixel(...screenA));
    const halfB = Array.from(pixel(...screenB));
    const expA = blend(baseA, cellA.rgb, 0.5);
    const expB = blend(baseB, cellB.rgb, 0.5);
    const distinctA = [
        0,
        1,
        2
    ].some((i)=>Math.abs(halfA[i] - baseA[i]) > 15 && Math.abs(halfA[i] - cellA.rgb[i]) > 15);
    const distinctB = [
        0,
        1,
        2
    ].some((i)=>Math.abs(halfB[i] - baseB[i]) > 15 && Math.abs(halfB[i] - cellB.rgb[i]) > 15);
    emit({
        check: 'overlay-blends-at-half-opacity',
        pass: same(halfA, expA, 3) && same(halfB, expB, 3) && distinctA && distinctB,
        detail: `A expected ${expA.join(',')} got ${halfA.join(',')}; B expected ${expB.join(',')} got ${halfB.join(',')}`
    });
    const track = map.getSliderTrack();
    const xFor = (v)=>track.x0 + (track.x1 - track.x0) * v / 100;
    const clickSlider = (x)=>{
        const y = track.y;
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: x,
            clientY: y,
            pointerId: 2,
            bubbles: true
        }));
        canvas.dispatchEvent(new PointerEvent('pointerup', {
            clientX: x,
            clientY: y,
            pointerId: 2,
            bubbles: true
        }));
    };
    const dragSlider = (from, to)=>{
        const y = track.y;
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: from,
            clientY: y,
            pointerId: 3,
            bubbles: true
        }));
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: to,
            clientY: y,
            pointerId: 3,
            bubbles: true
        }));
        canvas.dispatchEvent(new PointerEvent('pointerup', {
            clientX: to,
            clientY: y,
            pointerId: 3,
            bubbles: true
        }));
    };
    clickSlider(xFor(25));
    const o25 = map.opacity;
    const at25 = pixel(...screenA);
    const exp25 = blend(baseA, cellA.rgb, 0.25);
    const knob25 = map.getKnobPos();
    const ok25 = map.opacity === 25 && Math.abs(knob25[0] - xFor(25)) < 0.01 && same(at25, exp25, 3);
    dragSlider(xFor(25), track.x0 - 300);
    const o0 = map.opacity;
    const at0 = pixel(...screenA);
    const knob0 = map.getKnobPos();
    const ok0 = map.opacity === 0 && Math.abs(knob0[0] - track.x0) < 0.01 && same(at0, baseA, 1);
    dragSlider(track.x0, track.x1 + 400);
    const o100 = map.opacity;
    const at100 = pixel(...screenA);
    const knob100 = map.getKnobPos();
    const ok100 = map.opacity === 100 && Math.abs(knob100[0] - track.x1) < 0.01 && same(at100, cellA.rgb, 2);
    emit({
        check: 'slider-sets-and-clamps-opacity',
        pass: ok25 && ok0 && ok100,
        detail: `25%: opacity=${o25} knob=${knob25[0].toFixed(1)}/${xFor(25).toFixed(1)} ` + `pixel=${at25.join(',')} (exp ${exp25.join(',')}); drag left -> 0% pixel=${at0.join(',')}; ` + `drag right -> ${o100}% pixel=${at100.join(',')}`
    });
    map.setOpacity(100);
    const rect0 = map.getOverlayRect();
    const [bcx, bcy] = map.getScreenPos((OVERLAY.west + OVERLAY.east) / 2, (OVERLAY.south + OVERLAY.north) / 2);
    map.zoomAtPoint(bcx, bcy, map.zoom + 1);
    const rect1 = map.getOverlayRect();
    const zoomA = pixel(...map.getScreenPos(...insideA));
    emit({
        check: 'overlay-anchors-on-zoom',
        pass: Math.abs(rect1.width - rect0.width * 2) < 1 && Math.abs(rect1.height - rect0.height * 2) < 1 && same(zoomA, cellA.rgb, 2),
        detail: `rect ${rect0.width.toFixed(1)}x${rect0.height.toFixed(1)} -> ${rect1.width.toFixed(1)}x${rect1.height.toFixed(1)}, ` + `A pixel ${fmt(zoomA)}`
    });
    map.resetView();
    map.setOpacity(50);
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
