import { emit } from '../../../harness/page/bench.js';
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const LINE = [
    [
        -77.0366048812866,
        38.89873175227713
    ],
    [
        -77.03364372253417,
        38.89876515143842
    ],
    [
        -77.03364372253417,
        38.89549195896866
    ],
    [
        -77.02982425689697,
        38.89549195896866
    ],
    [
        -77.02400922775269,
        38.89387200688839
    ],
    [
        -77.01519012451172,
        38.891416957534204
    ],
    [
        -77.01521158218382,
        38.892068305429156
    ],
    [
        -77.00813055038452,
        38.892051604275686
    ],
    [
        -77.00832366943358,
        38.89143365883688
    ],
    [
        -77.00818419456482,
        38.89082405874451
    ],
    [
        -77.00815200805664,
        38.88989712255097
    ]
];
const START_CENTER = [
    -77.0214,
    38.897
];
const START_ZOOM = 12;
const PADDING = 20;
const midLng = (LINE[2][0] + LINE[3][0]) / 2;
const midLat = (LINE[2][1] + LINE[3][1]) / 2;
let minMx = Infinity, maxMx = -Infinity, minMy = Infinity, maxMy = -Infinity;
for (const [lon, lat] of LINE){
    const mx = mercX(lon), my = mercY(lat);
    if (mx < minMx) minMx = mx;
    if (mx > maxMx) maxMx = mx;
    if (my < minMy) minMy = my;
    if (my > maxMy) maxMy = my;
}
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
    const isPurple = (px)=>Math.abs(px[0] - 191) < 40 && Math.abs(px[1] - 147) < 35 && Math.abs(px[2] - 228) < 30 && px[2] > px[0] + 15;
    const fmt = (px)=>`rgb(${px[0]},${px[1]},${px[2]})`;
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
    for(let t = 0; t < 300 && !map.baseLoaded(); t++)await sleep(50);
    const visible = map.baseVisible();
    const ready = await waitForBase(map, visible);
    const colours = distinctColours(map);
    emit({
        check: 'basemap-drawn',
        pass: map.baseLoaded() && visible >= 2 && ready === visible && colours > 150,
        detail: `${ready}/${visible} tiles ready, ${colours} distinct colours in the frame`
    });
    const basin = patchMean(...map.getScreenPos(-77.04, 38.882));
    const mall = patchMean(...map.getScreenPos(-77.0355, 38.8905));
    emit({
        check: 'basemap-shows-geography',
        pass: basin[2] > basin[0] + 20 && mall[1] > mall[0] + 15,
        detail: `Potomac rgb(${basin.map(Math.round).join(',')}), lawn rgb(${mall.map(Math.round).join(',')})`
    });
    const [startByX, startByY] = map.getScreenPos(-77.03364372253417, 38.89876515143842);
    const startLine = pixel(startByX, startByY);
    const [midX0, midY0] = map.getScreenPos(midLng, midLat);
    const startMid = pixel(midX0, midY0);
    emit({
        check: 'line-rendered-before-fit',
        pass: isPurple(startLine) && isPurple(startMid) && Math.abs(map.zoom - START_ZOOM) < 1e-9 && Math.abs(map.centerMercator[0] - mercX(START_CENTER[0])) < 1e-9,
        detail: `zoom=${map.zoom}, vertex ${fmt(startLine)}, segment midpoint ${fmt(startMid)}`
    });
    document.getElementById('zoomto')?.click();
    const expectedScale = Math.min((width - 2 * PADDING) / (maxMx - minMx), (height - 2 * PADDING) / (maxMy - minMy));
    const expectedZoom = Math.log2(expectedScale / 256);
    const [cx, cy] = map.centerMercator;
    emit({
        check: 'fit-button-centres-line',
        pass: Math.abs(cx - (minMx + maxMx) / 2) < 1e-8 && Math.abs(cy - (minMy + maxMy) / 2) < 1e-8 && Math.abs(map.zoom - expectedZoom) < 2e-4,
        detail: `centre mx=${cx.toFixed(9)} my=${cy.toFixed(9)}, zoom=${map.zoom.toFixed(6)} expected ${expectedZoom.toFixed(6)} (bake quantises route to 8 decimals)`
    });
    const pts = LINE.map(([lon, lat])=>map.getScreenPos(lon, lat));
    const xs = pts.map((p)=>p[0]);
    const ys = pts.map((p)=>p[1]);
    const minSx = Math.min(...xs), maxSx = Math.max(...xs);
    const minSy = Math.min(...ys), maxSy = Math.max(...ys);
    const inside = minSx >= PADDING - 0.5 && maxSx <= width - PADDING + 0.5 && minSy >= PADDING - 0.5 && maxSy <= height - PADDING + 0.5;
    const touches = Math.abs(minSx - PADDING) < 0.5 || Math.abs(maxSx - (width - PADDING)) < 0.5 || Math.abs(minSy - PADDING) < 0.5 || Math.abs(maxSy - (height - PADDING)) < 0.5;
    emit({
        check: 'fit-keeps-line-in-padding',
        pass: inside && touches,
        detail: `x ${minSx.toFixed(1)}..${maxSx.toFixed(1)} (pad ${PADDING}..${width - PADDING}), ` + `y ${minSy.toFixed(1)}..${maxSy.toFixed(1)}`
    });
    const [mx0, my0] = map.getScreenPos(midLng, midLat);
    drag(500, 400, 560, 440);
    const [mx1, my1] = map.getScreenPos(midLng, midLat);
    const panPx = pixel(mx1, my1);
    emit({
        check: 'line-follows-pan',
        pass: Math.abs(mx1 - mx0 - 60) < 0.6 && Math.abs(my1 - my0 - 40) < 0.6 && isPurple(panPx),
        detail: `moved ${(mx1 - mx0).toFixed(1)},${(my1 - my0).toFixed(1)} px, midpoint ${fmt(panPx)}`
    });
    const [zx0, zy0] = map.getScreenPos(midLng, midLat);
    const [vx0, vy0] = map.getScreenPos(LINE[0][0], LINE[0][1]);
    map.zoomAtPoint(zx0, zy0, map.zoom + 1);
    const [zx1, zy1] = map.getScreenPos(midLng, midLat);
    const [vx1, vy1] = map.getScreenPos(LINE[0][0], LINE[0][1]);
    const zoomPx = pixel(zx1, zy1);
    const dx0 = vx0 - zx0, dy0 = vy0 - zy0;
    const dx1 = vx1 - zx1, dy1 = vy1 - zy1;
    emit({
        check: 'line-anchors-on-zoom',
        pass: Math.abs(zx1 - zx0) < 0.6 && Math.abs(zy1 - zy0) < 0.6 && isPurple(zoomPx) && Math.abs(dx1 - dx0 * 2) < 1 && Math.abs(dy1 - dy0 * 2) < 1,
        detail: `midpoint moved ${(zx1 - zx0).toFixed(2)},${(zy1 - zy0).toFixed(2)}; ` + `first vertex offset ${dx0.toFixed(1)},${dy0.toFixed(1)} -> ${dx1.toFixed(1)},${dy1.toFixed(1)}`
    });
    map.resetView();
    const [rx, ry] = map.getScreenPos(midLng, midLat);
    const resetPx = pixel(rx, ry);
    emit({
        check: 'reset-view-restores-start',
        pass: Math.abs(map.zoom - START_ZOOM) < 1e-9 && isPurple(resetPx) && Math.abs(map.centerMercator[0] - mercX(START_CENTER[0])) < 1e-9,
        detail: `zoom=${map.zoom}, midpoint at (${rx.toFixed(1)},${ry.toFixed(1)}) ${fmt(resetPx)}`
    });
    document.getElementById('zoomto')?.click();
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
    map.fitLine();
    await waitForBase(map, map.baseVisible());
    emit({
        done: true
    });
}
