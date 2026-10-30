import { emit } from '../../../harness/page/bench.js';
const BOUNDS = [
    [
        32.958984,
        -5.353521
    ],
    [
        43.50585,
        5.615985
    ]
];
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
async function waitForBase(map, want, ms = 20000) {
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
    const pixelAt = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p.join(',')})`;
    const isCornerDot = (p)=>p[0] === 230 && p[1] === 57 && p[2] === 70;
    const isCentreDot = (p)=>p[0] === 30 && p[1] === 111 && p[2] === 217;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const project = (mx, my)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        return [
            w / 2 + (mx - cx) * scale,
            h / 2 + (my - cy) * scale
        ];
    };
    const west = BOUNDS[0][0], south = BOUNDS[0][1];
    const east = BOUNDS[1][0], north = BOUNDS[1][1];
    const minX = mercX(west), maxX = mercX(east);
    const minY = mercY(north), maxY = mercY(south);
    const expScale = Math.min(w / (maxX - minX), h / (maxY - minY));
    const expZoom = Math.log2(expScale / 256);
    const expCx = (minX + maxX) / 2, expCy = (minY + maxY) / 2;
    for(let t = 0; t < 300 && !map.baseLoaded(); t++)await sleep(50);
    const visible0 = map.baseVisible();
    const ready0 = await waitForBase(map, visible0);
    const colours0 = distinctColours(map);
    emit({
        check: 'basemap-drawn',
        pass: map.baseLoaded() && visible0 >= 2 && ready0 === visible0 && colours0 > 150,
        detail: `${ready0}/${visible0} tiles ready, ${colours0} distinct colours`
    });
    emit({
        check: 'initial-view-is-new-york',
        pass: map.zoom === 9 && Math.abs(map.center[0] - mercX(-74.5)) < 1e-9 && Math.abs(map.center[1] - mercY(40)) < 1e-9,
        detail: `zoom ${map.zoom}, centre [${map.center.map((v)=>v.toFixed(6)).join(',')}]`
    });
    document.getElementById('fit')?.click();
    emit({
        check: 'fit-sets-camera',
        pass: Math.abs(map.zoom - expZoom) < 0.005 && Math.abs(map.center[0] - expCx) < 1e-9 && Math.abs(map.center[1] - expCy) < 1e-9,
        detail: `zoom ${map.zoom.toFixed(4)} vs ${expZoom.toFixed(4)}, centre [${map.center.map((v)=>v.toFixed(6)).join(',')}]`
    });
    const nw = project(minX, minY);
    const ne = project(maxX, minY);
    const sw = project(minX, maxY);
    const se = project(maxX, maxY);
    const left = nw[0], right = w - ne[0], top = nw[1], bottom = h - se[1];
    emit({
        check: 'fit-bounds-flush',
        pass: Math.min(Math.abs(left), Math.abs(top)) < 1.5 && Math.abs(left - right) < 1.5 && Math.abs(top - bottom) < 1.5 && left > -0.5 && top > -0.5,
        detail: `margins L ${left.toFixed(1)}, R ${right.toFixed(1)}, T ${top.toFixed(1)}, B ${bottom.toFixed(1)}`
    });
    const nwPx = pixelAt(nw[0], 3);
    const nePx = pixelAt(ne[0], 3);
    const swPx = pixelAt(sw[0], h - 3);
    const sePx = pixelAt(se[0], h - 3);
    const midPx = pixelAt(w / 2, h / 2);
    emit({
        check: 'fit-corner-markers-drawn',
        pass: isCornerDot(nwPx) && isCornerDot(nePx) && isCornerDot(swPx) && isCornerDot(sePx) && isCentreDot(midPx),
        detail: `NW ${fmt(nwPx)}, NE ${fmt(nePx)}, SW ${fmt(swPx)}, SE ${fmt(sePx)}, centre ${fmt(midPx)}`
    });
    map.panBy(80, 50);
    const nw2 = project(minX, minY);
    const moved = pixelAt(nw2[0], nw2[1] + 3);
    const oldSpot = pixelAt(nw[0], 3);
    emit({
        check: 'pan-moves-bounds',
        pass: Math.round(nw2[0] - nw[0]) === 80 && Math.round(nw2[1] - nw[1]) === 50 && isCornerDot(moved) && !isCornerDot(oldSpot),
        detail: `NW moved (${(nw2[0] - nw[0]).toFixed(1)},${(nw2[1] - nw[1]).toFixed(1)}), old ${fmt(oldSpot)}, new ${fmt(moved)}`
    });
    const mid2 = project((minX + maxX) / 2, (minY + maxY) / 2);
    map.zoomAtPoint(mid2[0], mid2[1], expZoom + 1);
    const nw3 = project(minX, minY);
    const expectNwX = mid2[0] + (nw2[0] - mid2[0]) * 2;
    const expectNwY = mid2[1] + (nw2[1] - mid2[1]) * 2;
    const mid3 = pixelAt(mid2[0], mid2[1]);
    emit({
        check: 'zoom-keeps-bounds',
        pass: Math.abs(map.zoom - (expZoom + 1)) < 0.005 && Math.abs(nw3[0] - expectNwX) < 1.5 && Math.abs(nw3[1] - expectNwY) < 1.5 && isCentreDot(mid3),
        detail: `zoom ${map.zoom.toFixed(4)}, NW (${nw3[0].toFixed(1)},${nw3[1].toFixed(1)}) expected (${expectNwX.toFixed(1)},${expectNwY.toFixed(1)}), centre ${fmt(mid3)}`
    });
    map.resetView();
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
    document.getElementById('fit')?.click();
    await waitForBase(map, map.baseVisible());
    emit({
        done: true
    });
}
