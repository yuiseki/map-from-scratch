import { emit } from '../../../harness/page/bench.js';
const BOX_W = 222;
const BOX_H = 28;
const MARGIN = 12;
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
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const rgba = (x, y)=>Array.from(ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data);
    const fmt = (p)=>`rgba(${p[0]},${p[1]},${p[2]},${p[3]})`;
    const isBox = (p)=>p[0] >= 242 && p[1] >= 242 && p[2] >= 242;
    const darkText = (x, y, bw, bh)=>{
        const data = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.round(bw * dpr), Math.round(bh * dpr)).data;
        let n = 0;
        for(let i = 0; i < data.length; i += 4){
            if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) n++;
        }
        return n;
    };
    const expected = (corner)=>[
            corner.endsWith('left') ? MARGIN : w - BOX_W - MARGIN,
            corner.startsWith('top') ? MARGIN : h - BOX_H - MARGIN
        ];
    const rectAt = (corner)=>{
        const [x, y] = expected(corner);
        const r = map.getAttributionRect();
        return Math.abs(r.x - x) < 0.5 && Math.abs(r.y - y) < 0.5 && r.width === BOX_W && r.height === BOX_H;
    };
    const sample = (corner)=>{
        const [x, y] = expected(corner);
        return {
            box: isBox(rgba(x + BOX_W - 12, y + 6)),
            text: darkText(x, y, BOX_W, BOX_H)
        };
    };
    const project = (lng, lat)=>{
        const scale = 256 * Math.pow(2, map.zoom);
        const [cx, cy] = map.center;
        return [
            w / 2 + (mercX(lng) - cx) * scale,
            h / 2 + (mercY(lat) - cy) * scale
        ];
    };
    const isLand = (p)=>p[0] > 225 && p[1] > 225 && p[2] > 210;
    const isOcean = (p)=>p[0] < 190 && p[1] > 190 && p[2] > 210;
    const tl = sample('top-left');
    emit({
        check: 'attribution-visible-top-left',
        pass: map.position === 'top-left' && rectAt('top-left') && tl.box && tl.text > 20,
        detail: `rect ${JSON.stringify(map.getAttributionRect())}, text px ${tl.text}`
    });
    const br = sample('bottom-right');
    const bl = sample('bottom-left');
    emit({
        check: 'default-corners-free',
        pass: !br.box && !bl.box && br.text < 5 && bl.text < 5,
        detail: `bottom-right ${fmt(rgba(expected('bottom-right')[0] + BOX_W - 12, expected('bottom-right')[1] + 6))}, bottom-left box px ${bl.box}`
    });
    const [cx, cy] = project(-77.04, 38.907);
    const [ox, oy] = project(-60, 30);
    emit({
        check: 'map-rendered-at-target',
        pass: isLand(rgba(cx, cy)) && isOcean(rgba(ox, oy)),
        detail: `land ${fmt(rgba(cx, cy))}, ocean ${fmt(rgba(ox, oy))}`
    });
    const rectBeforePan = map.getAttributionRect();
    const beforeX = cx, beforeY = cy;
    map.panBy(120, 90);
    const [ax, ay] = project(-77.04, 38.907);
    const rectAfterPan = map.getAttributionRect();
    const tlAfterPan = sample('top-left');
    emit({
        check: 'attribution-fixed-on-pan',
        pass: Math.abs(ax - beforeX - 120) < 0.01 && Math.abs(ay - beforeY - 90) < 0.01 && rectAfterPan.x === rectBeforePan.x && rectAfterPan.y === rectBeforePan.y && tlAfterPan.box && tlAfterPan.text > 20,
        detail: `map moved (${(ax - beforeX).toFixed(1)},${(ay - beforeY).toFixed(1)}) px, rect unchanged`
    });
    map.panBy(-120, -90);
    const rectBeforeZoom = map.getAttributionRect();
    map.setZoom(3.5);
    const rectAfterZoom = map.getAttributionRect();
    const tlAfterZoom = sample('top-left');
    emit({
        check: 'attribution-fixed-on-zoom',
        pass: map.zoom === 3.5 && rectAfterZoom.x === rectBeforeZoom.x && rectAfterZoom.y === rectBeforeZoom.y && tlAfterZoom.box && tlAfterZoom.text > 20,
        detail: `zoom ${map.zoom}, rect ${JSON.stringify(rectAfterZoom)}`
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
