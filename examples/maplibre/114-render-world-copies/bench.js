import { emit } from '../../../harness/page/bench.js';
const AFRICA_EQUATOR = [
    20,
    0
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
    const isAccent = (p)=>p[0] === ACCENT[0] && p[1] === ACCENT[1] && p[2] === ACCENT[2];
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
    const clickRow = (i)=>{
        const r = map.getRowRect(i);
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
            clientX: r.x + r.width / 2,
            clientY: r.y + r.height / 2,
            pointerId: 1,
            pointerType: 'mouse',
            bubbles: true,
            buttons: 1
        }));
        canvas.dispatchEvent(new PointerEvent('pointerup', {
            clientX: r.x + r.width / 2,
            clientY: r.y + r.height / 2,
            pointerId: 1,
            pointerType: 'mouse',
            bubbles: true,
            buttons: 0
        }));
    };
    const onRadio = map.getRadioRect(0);
    const offRadio = map.getRadioRect(1);
    const onPx = pixelAt(onRadio.x + 6, onRadio.y + 6);
    const offPx = pixelAt(offRadio.x + 6, offRadio.y + 6);
    emit({
        check: 'panel-visible',
        pass: map.worldCopies && isAccent(onPx) && offPx[0] > 245 && offPx[1] > 245 && offPx[2] > 245,
        detail: `On radio ${fmt(onPx)}, Off radio ${fmt(offPx)}`
    });
    const scale0 = map.worldWidth();
    const africa = project(AFRICA_EQUATOR[0], AFRICA_EQUATOR[1]);
    const africaCopy = [
        africa[0] - scale0,
        africa[1]
    ];
    const primaryPx = pixelAt(africa[0], africa[1]);
    const copyPx = pixelAt(africaCopy[0], africaCopy[1]);
    emit({
        check: 'copies-visible-by-default',
        pass: map.worldCopies && isLand(primaryPx) && isLand(copyPx),
        detail: `world ${scale0.toFixed(2)} px, primary ${fmt(primaryPx)} at ` + `(${africa[0].toFixed(1)},${africa[1].toFixed(1)}), copy ${fmt(copyPx)}`
    });
    let mismatches = 0;
    let sampled = 0;
    const row = Math.round(africa[1]);
    for(let x = 200; x < 400; x++){
        const a = pixelAt(x, row);
        const b = pixelAt(x + scale0, row);
        sampled++;
        if (isLand(a) !== isLand(b)) mismatches++;
    }
    emit({
        check: 'copies-are-true-copies',
        pass: mismatches <= 10,
        detail: `${mismatches}/${sampled} land/ocean mismatches at row ${row} shifted by ${scale0.toFixed(2)} px`
    });
    clickRow(1);
    const offTick = pixelAt(offRadio.x + 6, offRadio.y + 6);
    const primaryOff = pixelAt(africa[0], africa[1]);
    const copyOff = pixelAt(africaCopy[0], africaCopy[1]);
    emit({
        check: 'copies-off-single-world',
        pass: map.worldCopies === false && isAccent(offTick) && isLand(primaryOff) && isOcean(copyOff),
        detail: `Off radio ${fmt(offTick)}, primary ${fmt(primaryOff)}, ` + `neighbour ${fmt(copyOff)}`
    });
    clickRow(0);
    const restored = pixelAt(africaCopy[0], africaCopy[1]);
    emit({
        check: 'copies-on-restored',
        pass: map.worldCopies === true && isLand(restored),
        detail: `worldCopies=${map.worldCopies}, neighbour ${fmt(restored)}`
    });
    map.panBy(100, 0);
    const primaryPan = project(AFRICA_EQUATOR[0], AFRICA_EQUATOR[1]);
    const copyPan = [
        primaryPan[0] - map.worldWidth(),
        primaryPan[1]
    ];
    emit({
        check: 'pan-keeps-copies',
        pass: isLand(pixelAt(primaryPan[0], primaryPan[1])) && isLand(pixelAt(copyPan[0], copyPan[1])) && Math.abs(primaryPan[0] - (africa[0] + 100)) < 1e-6,
        detail: `primary moved to (${primaryPan[0].toFixed(1)},${primaryPan[1].toFixed(1)}), ` + `copy ${fmt(pixelAt(copyPan[0], copyPan[1]))}`
    });
    map.resetView();
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
