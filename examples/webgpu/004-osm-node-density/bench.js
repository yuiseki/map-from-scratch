import { emit, benchFramesGpu, zoomPath } from '../../../harness/page/bench.js';
export async function run(map, mounted) {
    const { device, cam } = map;
    device.lost.then((e)=>emit({
            error: `WebGPU device lost: ${e.message}`
        }));
    const t0 = performance.now();
    map.draw();
    await device.queue.onSubmittedWorkDone();
    emit({
        metric: 'first_frame_ms',
        value: mounted + performance.now() - t0
    });
    emit({
        info: {
            gpu: map.gpu,
            points: map.points,
            timestamps: device.features.has('timestamp-query')
        }
    });
    const [w, s, e, n] = map.bbox;
    const k = Math.cos((s + n) / 2 * Math.PI / 180), span = Math.max((e - w) * k, n - s);
    const grid = (lon, lat)=>[
            (lon - w) * k / span,
            (n - lat) / span
        ];
    const [cx, cy] = grid(139.7016, 35.658);
    const path = zoomPath(300, {
        cx,
        cy,
        z0: 1,
        z1: 256,
        pan: 0.0005
    });
    await benchFramesGpu(device, path.length, (i, ts)=>{
        cam.x = path[i].cx;
        cam.y = path[i].cy;
        cam.zoom = path[i].zoom;
        map.draw(ts, true);
    });
    for (const [prefix, zoom] of [
        [
            'whole_',
            1
        ],
        [
            'street_',
            256
        ]
    ]){
        cam.x = cx;
        cam.y = cy;
        cam.zoom = zoom;
        await benchFramesGpu(device, 60, (_, ts)=>map.draw(ts, true), {
            prefix
        });
    }
    const [W, H] = map.size();
    const bin = await fetch('../../../data/baked/04-osm-node-density/nodes.bin').then((r)=>r.arrayBuffer());
    const dx = new Uint16Array(bin, 40, map.points), dy = new Uint16Array(bin, 40 + map.points * 2, map.points);
    const EPS = 1e-3;
    const inside = (x, y)=>x >= 0 && y >= 0 && x < W && y < H;
    async function compare(x0, y0, zoom) {
        cam.x = x0;
        cam.y = y0;
        cam.zoom = zoom;
        map.draw();
        const counts = await map.readCounts();
        const f = Math.fround, ccx = f(cam.x), ccy = f(cam.y), sc = f(map.scale()), hw = f(W * 0.5), hh = f(H * 0.5);
        const sure = new Uint32Array(W * H), maybe = new Uint32Array(W * H);
        let edge = 0;
        for(let i = 0, x = 0, y = 0; i < map.points; i++){
            x = x + dx[i] & 0xffff;
            y = y + dy[i] & 0xffff;
            const px = f(f(f(f(x) / 65535) - ccx) * sc + hw), py = f(f(f(f(y) / 65535) - ccy) * sc + hh);
            const xs = new Set([
                Math.floor(px - EPS),
                Math.floor(px + EPS)
            ]), ys = new Set([
                Math.floor(py - EPS),
                Math.floor(py + EPS)
            ]);
            if (xs.size === 1 && ys.size === 1) {
                if (inside(px, py)) sure[Math.floor(py) * W + Math.floor(px)]++;
                continue;
            }
            edge++;
            for (const ex of xs)for (const ey of ys)if (inside(ex, ey)) maybe[ey * W + ex]++;
        }
        let differ = 0, outside = 0;
        for(let i = 0; i < sure.length; i++){
            if (counts[i] !== sure[i]) differ++;
            if (counts[i] < sure[i] || counts[i] > sure[i] + maybe[i]) outside++;
        }
        const detail = `${zoom}x: ${outside} of ${W * H} pixels outside the CPU bounds; ${differ} differ from the sure count; ${edge} points within ${EPS} px of an edge`;
        return outside === 0 ? null : detail;
    }
    cam.x = 0.5;
    cam.y = 0.5;
    cam.zoom = 0.9;
    map.draw();
    const counts = await map.readCounts();
    let sum = 0, max = 0;
    for (const c of counts){
        sum += c;
        if (c > max) max = c;
    }
    emit({
        info: {
            counted: sum,
            max_per_pixel: max
        }
    });
    emit({
        check: 'count-conservation',
        pass: sum === map.points,
        detail: `${sum} of ${map.points}`
    });
    const bad = [
        await compare(0.5, 0.5, 0.9),
        await compare(cx, cy, 6)
    ].filter((d)=>d !== null);
    emit({
        check: 'counts-match-cpu',
        pass: bad.length === 0,
        detail: bad.join(' / ') || 'every pixel within the CPU bounds at 0.9x and 6x'
    });
    const shown = await map.readScreen();
    const mid = ((H >> 1) * W + (W >> 1)) * 4;
    let brightest = 0;
    for(let i = 0; i < shown.length; i += 4)brightest = Math.max(brightest, shown[i + 1]);
    emit({
        info: {
            centre_rgb: [
                ...shown.subarray(mid, mid + 3)
            ].join(','),
            brightest_green: brightest
        }
    });
    emit({
        check: 'shibuya-not-empty',
        pass: !(shown[mid] < 20 && shown[mid + 1] < 20),
        detail: [
            ...shown.subarray(mid, mid + 3)
        ].join(',')
    });
    emit({
        check: 'ramp-reaches-bright',
        pass: brightest >= 200,
        detail: `max green ${brightest}`
    });
    emit({
        done: true
    });
}
