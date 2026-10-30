import { emit } from '../../../harness/page/bench.js';
const BG = {
    r: 233,
    g: 238,
    b: 242
};
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
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const px = (x, y)=>ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    const tj = map.tileJson;
    emit({
        check: 'tilejson-loaded',
        pass: !!tj && tj.tileSize === 512 && tj.tiles.length > 0 && tj.tiles[0].includes('{z}'),
        detail: tj ? `tileSize=${tj.tileSize} tiles=${tj.tiles[0]} z=${tj.minzoom}..${tj.maxzoom}` : 'no TileJSON'
    });
    let bg = 0;
    let samples = 0;
    for(let i = 1; i <= 8; i++){
        for(let j = 1; j <= 6; j++){
            const d = px(w * i / 9, h * j / 7);
            samples++;
            if (d[0] === BG.r && d[1] === BG.g && d[2] === BG.b) bg++;
        }
    }
    emit({
        check: 'tiles-cover-viewport',
        pass: bg === 0,
        detail: `${bg}/${samples} background pixels visible`
    });
    const edges = map.tileEdges().xs.filter((x)=>x > 12 && x < w - 12);
    const details = [];
    let onLine = 0;
    let looked = 0;
    for (const e of edges){
        for (const fy of [
            0.3,
            0.5,
            0.7,
            0.85
        ]){
            const y = h * fy;
            const d = px(e, y);
            const a = px(e - 6, y);
            const b = px(e + 6, y);
            const edgeBlue = d[2] - d[0];
            const neighbourBlue = (a[2] - a[0] + (b[2] - b[0])) / 2;
            looked++;
            if (edgeBlue - neighbourBlue > 40) onLine++;
            if (details.length < 3) {
                details.push(`x=${Math.round(e)} y=${Math.round(y)} rgb(${d[0]},${d[1]},${d[2]}) nb=${neighbourBlue.toFixed(0)}`);
            }
        }
    }
    emit({
        check: 'grid-lines-visible',
        pass: looked >= 8 && onLine / looked >= 0.7,
        detail: `${onLine}/${looked} edge samples on a grid line; ${details.join('; ')}`
    });
    const zi = Math.max(tj.minzoom, Math.min(tj.maxzoom, Math.round(map.zoom)));
    const n = 1 << zi;
    const worldX = (map.center.lon + 180) / 360;
    const worldY = (1 - Math.log(Math.tan(Math.PI / 4 + map.center.lat * Math.PI / 360)) / Math.PI) / 2;
    const expected = `${zi}/${Math.floor(worldX * n)}/${Math.floor(worldY * n)}`;
    const atCentre = map.tileAddressAt(w / 2, h / 2);
    const tileCss = tj.tileSize * Math.pow(2, map.zoom - zi);
    map.panBy(tileCss, 0);
    const afterPan = map.tileAddressAt(w / 2, h / 2);
    map.panBy(-tileCss, 0);
    const [z0, x0] = (atCentre ?? '').split('/').map(Number);
    const [z1, x1] = (afterPan ?? '').split('/').map(Number);
    const steppedWest = Number.isFinite(x1) && z1 === z0 && (x1 - x0 + n) % n === n - 1;
    emit({
        check: 'tile-address-follows-geography',
        pass: atCentre === expected && steppedWest,
        detail: `centre ${atCentre} (expected ${expected}); one tile west ${afterPan}`
    });
    const pts = [
        [
            0.3,
            0.3
        ],
        [
            0.5,
            0.5
        ],
        [
            0.7,
            0.3
        ],
        [
            0.3,
            0.7
        ],
        [
            0.7,
            0.7
        ],
        [
            0.5,
            0.6
        ]
    ];
    const before = pts.map(([fx, fy])=>{
        const d = px(w * fx, h * fy);
        return [
            d[0],
            d[1],
            d[2]
        ];
    });
    map.panBy(64, 48);
    let same = 0;
    pts.forEach(([fx, fy], i)=>{
        const d = px(w * fx + 64, h * fy + 48);
        if (d[0] === before[i][0] && d[1] === before[i][1] && d[2] === before[i][2]) same++;
    });
    emit({
        check: 'pan-moves-tiles-exactly',
        pass: same === pts.length,
        detail: `${same}/${pts.length} pixels identical after panBy(64,48)`
    });
    const ax = w * 0.4;
    const ay = h * 0.55;
    const world = map.worldAtScreen(ax, ay);
    const zoomBefore = Math.round(map.zoom);
    map.zoomAtPoint(ax, ay, map.zoom + 0.6);
    const [sx, sy] = map.screenOfWorld(world[0], world[1]);
    const err = Math.hypot(sx - ax, sy - ay);
    const zoomAfter = Math.round(map.zoom);
    const zAfter = map.tileAddressAt(w / 2, h / 2)?.split('/')[0];
    emit({
        check: 'zoom-keeps-point-and-tile-set',
        pass: err < 1.5 && zoomAfter === zoomBefore + 1 && zAfter === String(zoomAfter),
        detail: `drift ${err.toFixed(2)} px; z ${zoomBefore} -> ${zoomAfter}; tiles ${zAfter}`
    });
    await map.loadView();
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
    emit({
        done: true
    });
}
