import { emit, glRenderer, benchFrames } from '../../harness/page/bench.js';
import { S, CS, N0, R_EFF, project, groundMax, vertexPos } from './terrain.js';
import { VIEWS } from './views.js';
import { origReader } from './orig.js';
import { SKY } from './gl.js';
const BAKED = '../../data/baked/17-fuji-terrain-3d';
const HALF = 1536 * 15.578601873;
const frameEnd = ()=>new Promise((r)=>requestAnimationFrame(r));
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
const pct = (a, p)=>{
    const s = [
        ...a
    ].sort((x, y)=>x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
export async function run(map) {
    const { gl, canvas, cam, stats, net } = map;
    const W = canvas.width, H = canvas.height;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webgl context lost'
        }));
    const check = (id, pass, detail)=>{
        emit({
            check: id,
            pass,
            detail
        });
        emit({
            info: {
                [`check_${id}`]: detail
            }
        });
    };
    emit({
        metric: 'first_frame_ms',
        value: stats.complete
    });
    emit({
        metric: 'first_coarse_frame_ms',
        value: stats.coarse
    });
    emit({
        metric: 'range_requests_first',
        value: stats.completeNet.requests
    });
    emit({
        metric: 'range_bytes_first',
        value: stats.completeNet.bytes
    });
    const coarseLevels = [
        0,
        1,
        2,
        3
    ].map((k)=>stats.coarseDraw.filter((l)=>l === k).length);
    emit({
        info: {
            gpu: glRenderer(gl),
            page_data_ms: stats.complete - net.start,
            coarse_frame_chunks_per_level: coarseLevels,
            mount_at_ms: stats.mountAt,
            renderer_at_ms: stats.rendererAt,
            first_response_at_ms: stats.firstBytes,
            coarse_frame_start_ms: stats.coarseDrawAt,
            l3_decoded_at_ms: stats.l3Decoded,
            first_request_at_ms: net.start,
            samples: gl.getParameter(gl.SAMPLES),
            max_layers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)
        }
    });
    const local = await Promise.all([
        `${BAKED}/truth.json`,
        `${BAKED}/orig-costs.json`
    ].map((u)=>fetch(u)));
    const planet = await fetch('../../data/raw/mapterhorn/planet.pmtiles', {
        headers: {
            Range: 'bytes=0-0'
        }
    });
    if (local.some((r)=>!r.ok) || planet.status !== 206) {
        emit({
            error: `bench-only files missing (truth.json ${local[0].status}, orig-costs.json ${local[1].status}, planet.pmtiles ${planet.status}): this example's checks need the local bake and the local original, which are not on the Pages site`
        });
        emit({
            done: true
        });
        return;
    }
    const [truth, costs] = await Promise.all(local.map((r)=>r.json()));
    const t = map.terr;
    gl.getExtension('EXT_color_buffer_float');
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const att = (fmt, a)=>{
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, fmt, W, H);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, a, gl.RENDERBUFFER, rb);
    };
    att(gl.RGBA8, gl.COLOR_ATTACHMENT0);
    att(gl.RGBA32F, gl.COLOR_ATTACHMENT1);
    att(gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT);
    gl.drawBuffers([
        gl.COLOR_ATTACHMENT0,
        gl.COLOR_ATTACHMENT1
    ]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) emit({
        error: 'read-back framebuffer incomplete'
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const MAGENTA = [
        1,
        0,
        1
    ];
    const readBack = (draw)=>{
        draw(fbo);
        const color = new Uint8Array(W * H * 4), pos = new Float32Array(W * H * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, color);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, pos);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return {
            color,
            pos
        };
    };
    const ours = (clear = SKY)=>readBack((f)=>map.renderer.draw(t, map.view, map.sel.draw, f, clear));
    const screen = ()=>{
        map.frame();
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
    };
    const at = (img, x, y, k = 0)=>img[((H - 1 - y) * W + x) * 4 + k];
    const lum = (img, x, y)=>0.299 * at(img, x, y, 0) + 0.587 * at(img, x, y, 1) + 0.114 * at(img, x, y, 2);
    const toScreen = (v, c, r, h)=>{
        const x = (c - N0 / 2) * t.cell, y = (N0 / 2 - r) * t.cell, d2 = (x - v.eye[0]) ** 2 + (y - v.eye[1]) ** 2;
        const p = project(v, [
            x,
            y,
            h - d2 / (2 * R_EFF)
        ]);
        return p && p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H ? [
            Math.floor(p[0]),
            Math.floor(p[1])
        ] : null;
    };
    const setView = (c)=>Object.assign(cam, c);
    const loadedCold = async (c)=>{
        map.reset();
        setView(c);
        const t0 = performance.now();
        await map.open();
        await map.settled();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return {
            ms: performance.now() - t0,
            requests: net.requests,
            bytes: net.bytes
        };
    };
    const truthHeight = (p, k, x, y)=>{
        const nb = p.nb.find((b)=>b.k === k), s = 2 ** k;
        const smp = (c, r)=>{
            const i = c - nb.c0, j = r - nb.r0;
            return i < 0 || j < 0 || i > 3 || j > 3 ? NaN : nb.v[j * 4 + i] * 0.25 * s;
        };
        const axis = (q)=>{
            const j = Math.min(Math.floor(q / CS), N0 / CS / s - 1), l = q - j * CS;
            const u = l < 1.5 ? 0 : l >= CS - 0.5 ? CS - 1 : Math.floor(l - 0.5);
            const f = (l - vertexPos(u)) / (vertexPos(u + 1) - vertexPos(u));
            const pair = (w)=>(w === 0 ? [
                    -1,
                    0
                ] : w === CS ? [
                    CS - 1,
                    CS
                ] : [
                    w,
                    w
                ]).map((d)=>j * CS + d);
            return {
                f,
                v0: pair(u),
                v1: pair(u + 1)
            };
        };
        const ax = axis(x / t.cell / s + N0 / 2 / s), ay = axis((N0 / 2 - y / t.cell) / s);
        const vert = (cu, cv)=>(smp(cu[0], cv[0]) + smp(cu[1], cv[0]) + smp(cu[0], cv[1]) + smp(cu[1], cv[1])) / 4;
        const h00 = vert(ax.v0, ay.v0), h10 = vert(ax.v1, ay.v0), h01 = vert(ax.v0, ay.v1), h11 = vert(ax.v1, ay.v1);
        const fx = ax.f, fy = ay.f;
        const h = fx + fy <= 1 ? h00 + fx * (h10 - h00) + fy * (h01 - h00) : h11 + (1 - fx) * (h01 - h11) + (1 - fy) * (h10 - h11);
        return Number.isNaN(h) ? null : h;
    };
    const heightsMatch = (name)=>{
        const { pos } = ours();
        let n = 0, worst = 0, hidden = 0;
        const bad = [];
        for (const p of truth.probes){
            const s = toScreen(map.view, p.c + 0.5, p.r + 0.5, p.t / 256 - 32768);
            if (!s) continue;
            const tag = at(pos, s[0], s[1], 3), x = at(pos, s[0], s[1], 0), y = at(pos, s[0], s[1], 1), z = at(pos, s[0], s[1], 2);
            if (tag < 0 || tag >= 16) {
                hidden++;
                continue;
            }
            const want = truthHeight(p, tag, x, y);
            if (want === null) {
                hidden++;
                continue;
            }
            n++;
            worst = Math.max(worst, Math.abs(z - want));
            if (Math.abs(z - want) > 0.05) bad.push(`${p.name} L${tag} ${z.toFixed(3)} vs ${want.toFixed(3)}`);
        }
        return {
            name,
            n,
            hidden,
            worst: +worst.toFixed(4),
            bad: bad.slice(0, 5)
        };
    };
    const where = [];
    const holes = ()=>{
        const { color, pos } = ours(MAGENTA);
        let n = 0;
        for(let x = 0; x < W; x++){
            let first = -1, last = -1;
            const mag = (y)=>color[(y * W + x) * 4] === 255 && color[(y * W + x) * 4 + 1] === 0 && color[(y * W + x) * 4 + 2] === 255;
            for(let y = 0; y < H; y++)if (!mag(y)) {
                if (first < 0) first = y;
                last = y;
            }
            for(let y = first + 1; y < last; y++)if (mag(y)) {
                let a = y, b = y;
                while(mag(a))a--;
                while(mag(b))b++;
                const inner = (yy)=>Math.max(Math.abs(pos[(yy * W + x) * 4]), Math.abs(pos[(yy * W + x) * 4 + 1])) < HALF - 400;
                if (!inner(a) || !inner(b)) continue;
                n++;
                if (where.length < 6) where.push({
                    yaw: cam.yaw,
                    dist: cam.dist,
                    x,
                    y: H - 1 - y,
                    above: Array.from(pos.subarray(((y + 1) * W + x) * 4, ((y + 1) * W + x) * 4 + 4)).map((v)=>+v.toFixed(1)),
                    below: Array.from(pos.subarray(((y - 1) * W + x) * 4, ((y - 1) * W + x) * 4 + 4)).map((v)=>+v.toFixed(1))
                });
            }
        }
        return n;
    };
    const results = {};
    const holeCounts = {};
    const heightRuns = [];
    {
        const img = screen();
        let skyTop = 0, skyBottom = 0;
        const isSky = (x, y)=>[
                0,
                1,
                2
            ].every((k)=>Math.abs(at(img, x, y, k) - Math.round(SKY[k] * 255)) <= 2);
        for(let y = 0; y < Math.ceil(H * 0.03); y++)for(let x = 0; x < W; x++)if (isSky(x, y)) skyTop++;
        const skyAt = [];
        for(let y = Math.floor(H * 0.6); y < H; y++)for(let x = Math.floor(W * 0.2); x < W * 0.8; x++)if (isSky(x, y)) {
            skyBottom++;
            if (skyAt.length < 5) skyAt.push([
                x,
                y
            ]);
        }
        const topRatio = skyTop / (Math.ceil(H * 0.03) * W);
        check('sky-and-terrain', topRatio >= 0.95 && skyBottom === 0, {
            sky_top_ratio: +topRatio.toFixed(3),
            sky_px_bottom_40pct: skyBottom,
            at: skyAt
        });
        heightRuns.push(heightsMatch('default'));
        holeCounts.default = holes();
    }
    const orig = await origReader(gl, t);
    const ourCold = await loadedCold(VIEWS.default);
    const want = map.sel.want;
    const o = await orig.load(want);
    const td = performance.now();
    orig.draw(map.view, map.sel.draw, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const origMs = o.ms + performance.now() - td;
    emit({
        metric: 'data_first_frame_ms',
        value: ourCold.ms
    });
    emit({
        metric: 'orig_data_first_frame_ms',
        value: origMs
    });
    emit({
        metric: 'orig_range_requests_first',
        value: o.requests
    });
    emit({
        metric: 'orig_range_bytes_first',
        value: o.bytes
    });
    emit({
        metric: 'orig_decode_ms',
        value: o.decodeMs
    });
    emit({
        metric: 'bytes_ratio_first',
        value: ourCold.bytes / o.bytes
    });
    emit({
        metric: 'first_frame_ratio',
        value: ourCold.ms / origMs
    });
    results.default = {
        ours: ourCold,
        orig: o,
        model: costs.default
    };
    {
        const a = ours().pos, b = readBack((f)=>orig.draw(map.view, map.sel.draw, f)).pos;
        const d = [];
        for(let i = 0; i < W * H; i++){
            const ta = a[4 * i + 3], tb = b[4 * i + 3];
            if (ta >= 0 && ta < 16 && ta === tb) d.push(Math.abs(a[4 * i + 2] - b[4 * i + 2]));
        }
        const p99 = pct(d, 0.99);
        check('orig-vs-ours', p99 <= 0.6 && o.tileBytes === costs.default.orig.tile_bytes && o.bytes === costs.default.orig.bytes, {
            p99_m: +p99.toFixed(3),
            max_m: +pct(d, 1).toFixed(3),
            pixels: d.length,
            orig_bytes: o.bytes,
            orig_bytes_baked: costs.default.orig.bytes,
            tile_bytes: o.tileBytes
        });
    }
    for (const name of [
        'far',
        'close',
        'low',
        'top'
    ]){
        const r = await loadedCold(VIEWS[name]);
        emit({
            metric: `range_bytes_${name}`,
            value: r.bytes
        });
        emit({
            metric: `range_requests_${name}`,
            value: r.requests
        });
        heightRuns.push(heightsMatch(name));
        if (name === 'close' || name === 'low') holeCounts[name] = holes();
        const sel = map.sel, perLevel = [
            0,
            1,
            2,
            3
        ].map((k)=>sel.want.filter((id)=>t.chunks[id].k === k).length);
        if (name === 'close') {
            const l0 = perLevel[0], complete = sel.want.every((id)=>map.loaded[id]);
            check('deepest-level-close', l0 >= 50 && complete && sel.fallback === 0, {
                l0_chunks: l0,
                complete,
                fallback: sel.fallback
            });
            emit({
                metric: 'close_l0_chunks',
                value: l0
            });
            const { color: img, pos } = ours();
            const s = toScreen(map.view, truth.area.summit_c + 0.5, truth.area.summit_r + 0.5, truth.area.max);
            const eye = map.view.eye;
            let high = 0, snow = 0, zmax = -Infinity, atL0 = true, spread = 0, lo = Infinity, hi = 0;
            for(let dy = -2; dy <= 2; dy++)for(let dx = -2; dx <= 2; dx++){
                const x = s[0] + dx, y = s[1] + dy, tag = at(pos, x, y, 3);
                if (tag < 0 || tag >= 16) continue;
                const p = [
                    0,
                    1,
                    2
                ].map((k)=>at(pos, x, y, k)), h = p[2];
                zmax = Math.max(zmax, h);
                if (tag !== 0) atL0 = false;
                if (h < 3400) continue;
                high++;
                const dz = eye[2] - h, e0 = Math.exp(-h / 8000);
                const dens = Math.abs(dz) < 1 ? e0 : 8000 * (e0 - Math.exp(-eye[2] / 8000)) / dz;
                const f = Math.exp(-Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) * dens / 60000);
                const light = [
                    0,
                    1,
                    2
                ].map((k)=>(at(img, x, y, k) / 255 - SKY[k] * (1 - f)) / f);
                const sp = Math.max(...light) - Math.min(...light);
                spread = Math.max(spread, sp);
                lo = Math.min(lo, ...light);
                hi = Math.max(hi, ...light);
                if (sp <= 0.02 && Math.min(...light) >= 0.33 && Math.max(...light) <= 1.22) snow++;
            }
            check('summit-close', high >= 5 && snow === high && atL0 && zmax <= truth.area.max + 0.13 && zmax >= truth.area.max - 5, {
                px: s,
                summit_px_5x5: high,
                snow_px: snow,
                light_spread_max: +spread.toFixed(4),
                light_min: +lo.toFixed(3),
                light_max: +hi.toFixed(3),
                max_height_5x5: +zmax.toFixed(3),
                l0: atL0
            });
            const { color, pos: p2 } = ours();
            const L = (i)=>0.299 * color[4 * i] + 0.587 * color[4 * i + 1] + 0.114 * color[4 * i + 2];
            const seam = [], ctrl = [];
            for(let y = 0; y < H; y++)for(let x = 0; x + 1 < W; x++)for (const [i, j] of [
                [
                    y * W + x,
                    y * W + x + 1
                ],
                [
                    y * W + x,
                    (y + 1) * W + x
                ]
            ]){
                if (j >= W * H || p2[4 * i + 3] !== 0 || p2[4 * j + 3] !== 0) continue;
                for (const axis of [
                    0,
                    1
                ]){
                    const a = axis ? N0 / 2 - p2[4 * i + 1] / t.cell : p2[4 * i] / t.cell + N0 / 2;
                    const b = axis ? N0 / 2 - p2[4 * j + 1] / t.cell : p2[4 * j] / t.cell + N0 / 2;
                    const lo = Math.min(a, b), hi = Math.max(a, b);
                    if (hi - lo > 2) continue;
                    const edge = Math.floor(hi / CS) * CS;
                    if (lo < edge && edge <= hi) seam.push(Math.abs(L(i) - L(j)));
                    else if (lo < edge + 2.5 && edge + 2.5 <= hi) ctrl.push(Math.abs(L(i) - L(j)));
                }
            }
            const mean = (a)=>a.reduce((x, y)=>x + y, 0) / a.length;
            const ratio = mean(seam) / mean(ctrl);
            check('seam-shading', seam.length > 100 && ratio <= 1.3, {
                ratio: +ratio.toFixed(3),
                seam_pairs: seam.length,
                control_pairs: ctrl.length
            });
        }
        if (name === 'top') {
            const img = screen(), side = (s)=>{
                const v = truth.light.filter((l)=>l.side === s).map((l)=>toScreen(map.view, l.px[0], l.px[1], 2500)).filter((p)=>p);
                return v.reduce((a, p)=>a + lum(img, p[0], p[1]), 0) / v.length;
            };
            const nw = side('nw'), se = side('se');
            check('light-direction', nw - se >= 30, {
                nw: +nw.toFixed(1),
                se: +se.toFixed(1)
            });
        }
        await benchFrames(gl, 60, ()=>map.frame(), {
            prefix: `${name}_`
        });
        const ob = await orig.load(map.sel.want);
        emit({
            metric: `orig_range_bytes_${name}`,
            value: ob.bytes
        });
        emit({
            metric: `orig_range_requests_${name}`,
            value: ob.requests
        });
        if (name === 'close') {
            let n = 0, ok = 0;
            const bad = [];
            for (const p of truth.probes){
                const v = orig.texel(t.x0 + p.c, t.y0 + p.r);
                if (v === null) continue;
                n++;
                if (v === p.t) ok++;
                else bad.push(`${p.name}: ${v} vs ${p.t}`);
            }
            check('orig-decode-exact', n >= 10 && ok === n, {
                probes: n,
                exact: ok,
                bad: bad.slice(0, 5)
            });
        }
        results[name] = {
            ours: r,
            orig: ob,
            model: costs[name],
            per_level: perLevel,
            triangles: sel.draw.length * map.renderer.triangles
        };
    }
    orig.release();
    const hm = heightRuns.every((h)=>h.n >= 20 && h.bad.length === 0);
    check('heights-match-truth', hm, heightRuns);
    setView(VIEWS.default);
    map.frame();
    const ring = map.prefetchOrbit();
    while(ring.some((id)=>!map.loaded[id]))await sleep(20);
    emit({
        info: {
            orbit_prefetch_chunks: ring.length,
            orbit_prefetch_bytes: ring.reduce((a, id)=>a + t.chunks[id].len, 0)
        }
    });
    const sel = [];
    let waits = 0, tris = 0;
    const orbitHoles = [];
    await benchFrames(gl, 120, (i)=>{
        cam.yaw = 200 + 3 * i;
        map.frame();
        sel.push(stats.selectMs);
        if (!map.sel.want.every((id)=>map.loaded[id])) waits++;
        tris = Math.max(tris, map.sel.draw.length * map.renderer.triangles);
    });
    emit({
        metric: 'selection_ms',
        values: sel
    });
    emit({
        metric: 'fallback_frames',
        value: waits
    });
    for(let i = 0; i < 12; i++){
        cam.yaw = 200 + 30 * i;
        map.frame();
        orbitHoles.push(holes());
    }
    holeCounts.orbit = Math.max(...orbitHoles);
    check('orbit-no-wait', waits === 0, {
        fallback_frames: waits,
        max_triangles: tris
    });
    {
        const v = await loadedCold(VIEWS.default);
        const viewIds = [
            ...map.sel.want
        ];
        const ringIds = map.prefetchOrbit();
        while(ringIds.some((id)=>!map.loaded[id]))await sleep(20);
        const all = [
            ...new Set([
                ...viewIds,
                ...ringIds
            ])
        ];
        const ov = await orig.load(all);
        emit({
            metric: 'range_bytes_visit',
            value: net.bytes
        });
        emit({
            metric: 'range_requests_visit',
            value: net.requests
        });
        emit({
            metric: 'orig_range_bytes_visit',
            value: ov.bytes
        });
        emit({
            metric: 'bytes_ratio_visit',
            value: net.bytes / ov.bytes
        });
        emit({
            info: {
                visit: {
                    view_bytes: v.bytes,
                    prefetch_bytes: net.bytes - v.bytes,
                    chunks: all.length,
                    orig_tiles: ov.tiles,
                    orig_requests: ov.requests
                }
            }
        });
        orig.release();
    }
    {
        await loadedCold(VIEWS.default);
        const intervals = [];
        let fallback = 0, missing = 0, lastMiss = 0, prev = await frameEnd();
        map.frame();
        const t0 = prev;
        for(;;){
            const now = await frameEnd();
            intervals.push(now - prev);
            prev = now;
            if (now - t0 >= 2000) break;
            cam.yaw = 200 + 360 * (now - t0) / 2000;
            map.frame();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            const miss = map.sel.want.filter((id)=>!map.loaded[id]).length;
            if (miss) {
                fallback++;
                missing += miss;
                lastMiss = now - t0;
            }
        }
        const turnFrames = intervals.length - 1;
        cam.yaw = 200;
        await map.settled();
        emit({
            metric: 'orbit_cold_interval_ms',
            values: intervals
        });
        emit({
            metric: 'orbit_cold_interval_max_ms',
            value: Math.max(...intervals)
        });
        emit({
            metric: 'range_bytes_orbit_cold',
            value: net.bytes
        });
        emit({
            metric: 'range_requests_orbit_cold',
            value: net.requests
        });
        emit({
            metric: 'orbit_cold_fallback_ratio',
            value: fallback / turnFrames
        });
        emit({
            info: {
                orbit_cold_frames: turnFrames,
                orbit_cold_fallback_frames: fallback,
                orbit_cold_missing_chunk_frames: missing,
                orbit_cold_last_fallback_ms: Math.round(lastMiss),
                orbit_cold_longest_at: intervals.indexOf(Math.max(...intervals))
            }
        });
    }
    {
        await loadedCold(VIEWS.default);
        const intervals = [];
        let zoomFallback = 0, prev = await frameEnd();
        map.frame();
        const t0 = prev;
        for(;;){
            const now = await frameEnd();
            intervals.push(now - prev);
            prev = now;
            const target = 40000 * 0.25 ** Math.min(1, (now - t0) / 2000);
            canvas.dispatchEvent(new WheelEvent('wheel', {
                deltaY: Math.log(target / cam.dist) / 0.0015,
                clientX: W / 2,
                clientY: H / 2,
                cancelable: true
            }));
            map.frame();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            if (map.sel.want.some((id)=>!map.loaded[id])) zoomFallback++;
            if (now - t0 >= 2000) break;
        }
        await map.settled();
        emit({
            metric: 'zoom_cold_interval_ms',
            values: intervals
        });
        emit({
            metric: 'range_bytes_zoom_cold',
            value: net.bytes
        });
        emit({
            metric: 'zoom_cold_fallback_ratio',
            value: zoomFallback / intervals.length
        });
        holeCounts.zoom = holes();
        emit({
            info: {
                zoom_end_dist: Math.round(cam.dist),
                zoom_cold_frames: intervals.length,
                zoom_cold_fallback_frames: zoomFallback,
                zoom_cold_longest_at: intervals.indexOf(Math.max(...intervals))
            }
        });
    }
    check('no-holes', Object.values(holeCounts).every((n)=>n === 0), {
        ...holeCounts,
        where
    });
    {
        setView(VIEWS.default);
        map.frame();
        const ev = (type, x, y)=>canvas.dispatchEvent(new PointerEvent(type, {
                clientX: x,
                clientY: y,
                button: 0,
                pointerId: 1,
                bubbles: true
            }));
        ev('pointerdown', 600, 400);
        const inp = [];
        for(let i = 1; i <= 100; i++){
            const t0 = performance.now();
            ev('pointermove', 600 + 2 * i, 400 + i % 5);
            map.frame();
            inp.push(performance.now() - t0);
        }
        emit({
            metric: 'input_ms',
            values: inp
        });
        ev('pointermove', 820, 400);
        ev('pointerup', 820, 400);
        const spun = map.spinning;
        while(map.spinning)await frameEnd();
        await map.settled();
        await sleep(50);
        const f0 = stats.frames;
        await sleep(500);
        check('idle-no-frames', spun && stats.frames === f0, {
            inertia_started: spun,
            frames_in_500ms: stats.frames - f0
        });
    }
    {
        const [sx, sy] = [
            (truth.area.summit_c + 0.5 - N0 / 2) * t.cell,
            (N0 / 2 - truth.area.summit_r - 0.5) * t.cell
        ];
        setView({
            tx: sx,
            ty: sy - 6000,
            tz: 1800,
            yaw: 180,
            pitch: 8,
            dist: 20000
        });
        for(let i = 0; i < 40; i++)canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -200,
            cancelable: true
        }));
        map.frame();
        const e = map.view.eye, cl = (v)=>Math.min(N0 / CS - 1, Math.max(0, Math.floor(v / CS)));
        const ci = cl(N0 / 2 - e[1] / t.cell), cj = cl(e[0] / t.cell + N0 / 2);
        const under = truth.chunks.find(([k, i, j])=>k === 0 && i === ci && j === cj);
        const groundTruth = under[4] * 0.25, overSummit = cl(truth.area.summit_r) === ci && cl(truth.area.summit_c) === cj;
        const clearance = e[2] - groundTruth;
        check('camera-above-ground', cam.dist === 6000 && clearance >= 149 && overSummit && e[2] - truth.area.max >= 149, {
            dist: cam.dist,
            eye_z: +e[2].toFixed(2),
            ground_truth_m: groundTruth,
            clearance_m: +clearance.toFixed(2),
            over_summit_chunk: overSummit,
            above_summit_m: +(e[2] - truth.area.max).toFixed(2),
            index_hmax: groundMax(t, e[0], e[1])
        });
    }
    {
        const seen = new Map();
        map.hooks.decoded = (id, s)=>{
            let lo = Infinity, hi = -Infinity, sum = 0;
            for(let y = 1; y <= CS + 1; y++)for(let x = 1; x <= CS + 1; x++){
                const v = s[y * S + x];
                lo = Math.min(lo, v);
                hi = Math.max(hi, v);
                sum += v;
            }
            seen.set(id, [
                lo,
                hi,
                sum
            ]);
        };
        map.reset();
        setView(VIEWS.top);
        const t0 = performance.now();
        await map.open();
        map.fetchChunks(t.chunks.map((_, id)=>id), 1 << 20);
        while(map.loaded.some((l)=>!l))await sleep(20);
        emit({
            info: {
                all_chunks_ms: performance.now() - t0,
                all_bytes: net.bytes,
                all_requests: net.requests,
                decode_ms_total: stats.decodeMs
            }
        });
        let ok = 0;
        const bad = [];
        for (const [k, i, j, lo, hi, sum] of truth.chunks){
            const id = t.ids[k][i * (24 >> k) + j], s = seen.get(id), c = t.chunks[id], q = 0.25 * 2 ** k;
            if (s && s.join() === [
                lo,
                hi,
                sum
            ].join() && c.hmin === lo * q && c.hmax === hi * q) ok++;
            else bad.push(`L${k} ${i},${j}`);
        }
        check('chunk-stats-match', ok === t.chunks.length, {
            matched: ok,
            of: t.chunks.length,
            bad: bad.slice(0, 5)
        });
        map.hooks.decoded = undefined;
        map.tau = 0;
        map.frame();
        emit({
            metric: 'ceiling_tris',
            value: map.sel.draw.length * map.renderer.triangles
        });
        emit({
            info: {
                ceiling_chunks: map.sel.draw.length
            }
        });
        await benchFrames(gl, 30, ()=>map.frame(), {
            prefix: 'ceiling_'
        });
        map.tau = 1.5;
    }
    const samples = Math.max(1, gl.getParameter(gl.SAMPLES));
    const mb = (S * S * 2 * t.chunks.length + map.renderer.triangles * 6 + W * H * (8 * samples + 4)) / 2 ** 20;
    emit({
        metric: 'gpu_mem_est_mb',
        value: mb
    });
    emit({
        info: {
            cost_model_vs_measured: results,
            stale_bytes_after_reset: net.stale,
            requests_aborted_by_reset: net.aborted
        }
    });
    setView(VIEWS[new URLSearchParams(location.search).get('shot') ?? 'default']);
    map.frame();
    await frameEnd();
    emit({
        done: true
    });
}
