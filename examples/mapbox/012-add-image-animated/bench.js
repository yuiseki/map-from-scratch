import { emit } from '../../../harness/page/bench.js';
const DOT = [
    0,
    0
];
const LAND_POINT = [
    20,
    20
];
const OCEAN_POINT = [
    -30,
    30
];
const INNER_R = 15;
const GROWTH = 35;
const OCEAN = [
    170,
    211,
    223
];
const PINK = [
    255,
    200,
    200
];
const CORE = [
    255,
    100,
    100
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
    const near = (p, rgb, tol = 2)=>Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;
    const isOcean = (p)=>near(p, OCEAN, 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const project = (lon, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        return [
            w / 2 + (mercX(lon) - cx) * scale,
            h / 2 + (mercY(lat) - cy) * scale
        ];
    };
    const centre = ()=>project(DOT[0], DOT[1]);
    const at = (r)=>{
        const [cx, cy] = centre();
        return pixelAt(cx - r, cy);
    };
    const blend = (t)=>{
        const a = 1 - t;
        return OCEAN.map((c, i)=>Math.round(PINK[i] * a + c * (1 - a)));
    };
    const outerRadius = (t)=>INNER_R + GROWTH * t;
    const land = project(LAND_POINT[0], LAND_POINT[1]);
    const ocean = project(OCEAN_POINT[0], OCEAN_POINT[1]);
    emit({
        check: 'map-rendered-at-target',
        pass: map.zoom === 2 && pixelAt(land[0], land[1])[0] > 225 && pixelAt(land[0], land[1])[1] > 225 && isOcean(pixelAt(ocean[0], ocean[1])),
        detail: `zoom ${map.zoom}, land ${fmt(pixelAt(land[0], land[1]))}, ` + `ocean ${fmt(pixelAt(ocean[0], ocean[1]))}`
    });
    map.setPhase(0.4);
    const core = pixelAt(centre()[0], centre()[1]);
    emit({
        check: 'dot-core',
        pass: core[0] === CORE[0] && core[1] === CORE[1] && core[2] === CORE[2],
        detail: `centre ${fmt(core)} at phase ${map.phase().toFixed(2)}`
    });
    map.setPhase(0);
    const early = at(24);
    map.setPhase(0.5);
    const mid = at(24);
    const beyond = at(40);
    emit({
        check: 'ring-expands-with-phase',
        pass: isOcean(early) && near(mid, blend(0.5)) && isOcean(beyond),
        detail: `t=0 r24 ${fmt(early)}, t=0.5 r24 ${fmt(mid)} (want ${fmt([
            ...blend(0.5),
            255
        ])}), ` + `t=0.5 r40 ${fmt(beyond)}`
    });
    map.setPhase(0.9);
    const late = at(40);
    emit({
        check: 'ring-fades-with-phase',
        pass: near(late, blend(0.9)) && late[0] < mid[0] - 15 && isOcean(at(55)),
        detail: `t=0.9 r40 ${fmt(late)} (want ${fmt([
            ...blend(0.9),
            255
        ])}), ` + `r55 ${fmt(at(55))}`
    });
    map.setPhase(0.4);
    const before = centre();
    map.panBy(120, 60);
    const after = centre();
    const movedCore = pixelAt(after[0], after[1]);
    const oldSpot = pixelAt(before[0], before[1]);
    emit({
        check: 'dot-follows-pan',
        pass: Math.abs(after[0] - before[0] - 120) < 1e-6 && Math.abs(after[1] - before[1] - 60) < 1e-6 && movedCore[0] === CORE[0] && movedCore[1] === CORE[1] && isOcean(oldSpot),
        detail: `centre (${before[0]},${before[1]}) -> (${after[0]},${after[1]}), ` + `core ${fmt(movedCore)}, old spot ${fmt(oldSpot)}`
    });
    map.resetView();
    map.setPhase(0.5);
    const landBefore = project(LAND_POINT[0], LAND_POINT[1]);
    const ringBefore = at(24);
    const c0 = centre();
    map.zoomAtPoint(c0[0], c0[1], 5);
    const landAfter = project(LAND_POINT[0], LAND_POINT[1]);
    emit({
        check: 'dot-keeps-screen-size-on-zoom',
        pass: map.zoom === 5 && near(at(24), ringBefore) && isOcean(at(40)) && Math.abs(landAfter[0] - c0[0] - (landBefore[0] - c0[0]) * 8) < 1e-6,
        detail: `zoom ${map.zoom}, ring ${fmt(at(24))} (was ${fmt(ringBefore)}), ` + `land offset ${landBefore[0].toFixed(1)} -> ${landAfter[0].toFixed(1)}`
    });
    map.resetView();
    map.resume();
    let liveT = 0;
    let radiusOk = false;
    let insidePx = [];
    let outsidePx = [];
    const until = performance.now() + 1500;
    while(performance.now() < until){
        await new Promise(requestAnimationFrame);
        const t = map.phase();
        if (t < 0.35 || t > 0.6) continue;
        const r = outerRadius(t);
        insidePx = at(r - 6);
        outsidePx = at(r + 6);
        radiusOk = !isOcean(insidePx) && isOcean(outsidePx);
        liveT = t;
        break;
    }
    await sleep(250);
    const t2 = map.phase();
    const advanced = (t2 - liveT + 1) % 1;
    emit({
        check: 'animation-runs-live',
        pass: map.animating() && radiusOk && Math.abs(advanced - 0.25) < 0.15,
        detail: `phase ${liveT.toFixed(3)} -> ${t2.toFixed(3)} (+${advanced.toFixed(3)} in 250 ms), ` + `inside ${fmt(insidePx)}, outside ${fmt(outsidePx)}`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.draw();
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
    map.setPhase(0.35);
    await sleep(50);
    emit({
        done: true
    });
}
