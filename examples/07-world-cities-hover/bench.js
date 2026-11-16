import { emit, glRenderer, benchFrames, zoomPath } from '../../harness/page/bench.js';
import { equalEarth } from '../../tools/geo.js';
export async function run(map, tip, mounted) {
    const { gl, cam, n, pos, rad } = map;
    const AY = 1.3174 / 2.7066;
    const W = gl.canvas.width, H = gl.canvas.height, dpr = devicePixelRatio;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webgl context lost'
        }));
    const t = performance.now();
    map.draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    emit({
        metric: 'first_frame_ms',
        value: mounted + performance.now() - t
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            cities: n,
            land_vertices: map.landVertices,
            fan_triangles: map.fanTriangles,
            border_vertices: map.borderVertices,
            border_segments: map.borderSegments,
            canvas: [
                W,
                H
            ]
        }
    });
    const world = (lon, lat)=>{
        const [x, y] = equalEarth([
            lon,
            lat
        ]);
        return [
            (x + 2.7066) / (2 * 2.7066),
            (1.3174 - y) / (2 * 1.3174)
        ];
    };
    const screen = (wx, wy)=>[
            (wx - cam.x) * cam.zoom * W + W / 2,
            (wy - cam.y) * cam.zoom * W * AY + H / 2
        ];
    const set = (x, y, zoom)=>{
        cam.x = x;
        cam.y = y;
        cam.zoom = zoom;
    };
    const [ex, ey] = world(10, 50);
    const path = zoomPath(300, {
        cx: ex,
        cy: ey,
        z0: 1,
        z1: 32,
        pan: 0.002
    });
    await benchFrames(gl, path.length, (i)=>{
        set(path[i].cx, path[i].cy, path[i].zoom);
        map.draw();
    });
    await benchFrames(gl, 120, ()=>{
        set(0.5, 0.5, 1);
        map.draw();
    }, {
        prefix: 'whole_'
    });
    await benchFrames(gl, 120, ()=>{
        set(ex, ey, 32);
        map.draw();
    }, {
        prefix: 'deep_'
    });
    set(0.5, 0.5, 1);
    map.draw();
    let seed = 7;
    const rnd = ()=>(seed = seed * 16807 % 2147483647) / 2147483647;
    const hov = [];
    let hits = 0;
    for(let i = 0; i < 500; i++){
        const t0 = performance.now();
        const c = map.pick(rnd() * W, rnd() * H);
        map.setHover(c);
        hov.push(performance.now() - t0);
        if (c >= 0) hits++;
    }
    emit({
        metric: 'hover_ms',
        values: hov
    });
    map.setHover(-1);
    const reach = (zoom)=>{
        let ok = 0;
        for(let i = 0; i < n; i++){
            set(pos[2 * i] / 65535, pos[2 * i + 1] / 65535, zoom);
            if (map.pick(W / 2, H / 2) === i) ok++;
        }
        return ok / n;
    };
    const t0 = performance.now();
    const reachable = reach(32);
    emit({
        metric: 'reachable_ratio',
        value: reachable
    });
    emit({
        info: {
            reachable_at_1x: reach(1),
            reach_check_ms: performance.now() - t0,
            hover_hit_ratio: hits / 500
        }
    });
    set(0.5, 0.5, 1);
    map.draw();
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const at = (sx, sy)=>{
        const o = ((H - 1 - Math.floor(sy)) * W + Math.floor(sx)) * 4;
        return [
            px[o],
            px[o + 1],
            px[o + 2]
        ];
    };
    const near = (c, want)=>c.every((v, k)=>Math.abs(v - want[k]) <= 3);
    const LAND = [
        222,
        219,
        209
    ], SEA = [
        204,
        224,
        237
    ];
    let drawn = 0, orange = 0;
    for(let i = 0; i < n; i++){
        const c = at(...screen(pos[2 * i] / 65535, pos[2 * i + 1] / 65535));
        if (!near(c, LAND) && !near(c, SEA)) drawn++;
        if (c[0] - c[2] > 60) orange++;
    }
    emit({
        check: 'every-centre-drawn',
        pass: drawn === n,
        detail: `${drawn} of ${n}`
    });
    emit({
        info: {
            city_centres_orange: orange / n
        }
    });
    const g = at(...screen(...world(-40, 75)));
    emit({
        check: 'greenland-is-land',
        pass: near(g, LAND),
        detail: g.join(',')
    });
    const sea = at(...screen(...world(-140, -5)));
    emit({
        check: 'pacific-is-sea',
        pass: near(sea, SEA),
        detail: sea.join(',')
    });
    const tokyo = Array.from({
        length: n
    }, (_, i)=>i).find((i)=>map.city(i).name === '東京都');
    const move = (sx, sy)=>gl.canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: sx / dpr,
            clientY: sy / dpr,
            bubbles: true
        }));
    const [tx, ty] = [
        pos[2 * tokyo] / 65535,
        pos[2 * tokyo + 1] / 65535
    ];
    set(tx, ty, 8);
    move(W / 2, H / 2);
    map.draw();
    const hl = new Uint8Array(4);
    gl.readPixels(W / 2, H / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, hl);
    emit({
        check: 'tokyo-highlighted',
        pass: hl[2] > 150 && hl[0] < 60,
        detail: [
            ...hl
        ].join(',')
    });
    emit({
        check: 'tokyo-tooltip',
        pass: /東京都 \(日本\)\s+人口 35,676,000 人/.test(tip.textContent),
        detail: tip.textContent
    });
    set(0.5, 0.5, 1);
    move(...screen(...world(-140, -5)));
    emit({
        check: 'pacific-no-tooltip',
        pass: tip.textContent === '',
        detail: tip.textContent
    });
    const [bwx, bwy] = world(-110, 49);
    set(bwx, bwy, 8);
    map.draw();
    const bw = 33, bh = 33, bpx = new Uint8Array(bw * bh * 4);
    gl.readPixels(Math.floor((W - bw) / 2), Math.floor((H - bh) / 2), bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, bpx);
    let dark = 0;
    for(let i = 0; i < bpx.length; i += 4)if (bpx[i] < 190 && bpx[i + 1] < 190 && bpx[i + 2] < 190) dark++;
    emit({
        check: 'us-canada-border-drawn',
        pass: dark > 0,
        detail: `${dark} dark pixels at 49N 110W`
    });
    set(tx, ty, 4);
    move(W / 2, H / 2);
    map.draw();
    emit({
        info: {
            radius_px_tokyo: rad[tokyo] / 10
        }
    });
    emit({
        done: true
    });
}
