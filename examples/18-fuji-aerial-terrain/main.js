import { S, N0, LEVELS, FIRST_BYTES, parseTerr, decodeChunk, makeView, select, ranges, groundMax, FOV_Y } from './terrain.js';
import { createRenderer, HEIGHT_OURS } from './gl.js';
import { VIEWS, TAU } from './views.js';
import { openArchive } from './pmtiles.js';
const FILE = '../../data/baked/17-fuji-terrain-3d/fuji.terr';
const PHOTO_Z = 12, PHOTO_SIDE = 6, PHOTO_SIZE = 512;
const HALF = 1536 * 15.578601873;
const GAP = Number(new URLSearchParams(location.search).get('gap') ?? 8192);
export async function mount(canvas, { prefetch = true } = {}) {
    const mountAt = performance.now();
    const net = {
        requests: 0,
        bytes: 0,
        start: 0,
        stale: 0,
        aborted: 0
    };
    let gen = 0, abort = new AbortController();
    const body = async (r, g)=>{
        if (r.status !== 206) throw new Error(`fuji.terr: HTTP ${r.status} for a Range request`);
        const u8 = new Uint8Array(await r.arrayBuffer());
        if (g === gen) net.bytes += u8.length;
        else net.stale += u8.length;
        return u8;
    };
    const read = (start, end, priority = 'high')=>{
        if (!net.requests) net.start = performance.now();
        net.requests++;
        const g = gen;
        return fetch(FILE, {
            headers: {
                Range: `bytes=${start}-${end - 1}`
            },
            priority,
            signal: abort.signal
        }).then((r)=>body(r, g));
    };
    const early = window.__fujiFirst;
    if (early) {
        net.requests++;
        net.start = performance.now();
    }
    const first = early ? early.then((r)=>body(r, 0)) : read(0, FIRST_BYTES);
    const gl = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('WebGL2 is not available');
    const size = ()=>{
        canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
        canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    };
    size();
    const tex = gl.createTexture();
    const photoTex = gl.createTexture();
    let photoReady = false;
    const renderer = createRenderer(gl, HEIGHT_OURS, (p)=>{
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        gl.uniform1i(gl.getUniformLocation(p, 'u_h'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, photoTex);
        gl.uniform1i(gl.getUniformLocation(p, 'u_photo'), 1);
        gl.uniform1i(gl.getUniformLocation(p, 'u_photoReady'), photoReady ? 1 : 0);
    });
    const rendererAt = performance.now();
    let terr = parseTerr(await first);
    const firstAt = performance.now();
    const n = terr.chunks.length;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R16UI, S, S, n);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, photoTex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(N0)) + 1, gl.RGB8, N0, N0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const loaded = new Uint8Array(n), inflight = new Uint8Array(n), wanted = new Uint8Array(n);
    const samples = new Uint16Array(S * S);
    const queue = [];
    const stats = {
        mountAt,
        rendererAt,
        firstBytes: firstAt,
        l3Decoded: 0,
        coarseDrawAt: 0,
        coarse: 0,
        coarseDraw: [],
        complete: 0,
        completeNet: {
            requests: 0,
            bytes: 0
        },
        frames: 0,
        selectMs: 0,
        decodeMs: 0
    };
    const hooks = {};
    const mc = new MessageChannel();
    let pumping = false;
    mc.port1.onmessage = ()=>{
        const t0 = performance.now();
        let changed = false;
        while(queue.length && (performance.now() - t0 < 4 || terr.chunks[queue[0][0]].k === LEVELS - 1)){
            const [id, src] = queue.shift();
            decodeChunk(src, samples, terr.block);
            if (hooks.decoded) hooks.decoded(id, samples);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, id, S, S, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, samples);
            loaded[id] = 1;
            if (wanted[id] || !sel || sel.uncovered > 0) changed = true;
        }
        if (!stats.l3Decoded && changed && loaded.subarray(0, 9).every((l)=>l)) stats.l3Decoded = performance.now();
        stats.decodeMs += performance.now() - t0;
        pumping = queue.length > 0;
        if (pumping) mc.port2.postMessage(0);
        if (changed) render();
    };
    const ingest = (start, bytes, g)=>{
        if (g !== gen) return;
        for(let id = 0; id < n; id++){
            const c = terr.chunks[id];
            if (loaded[id] || c.off < start || c.off + c.len > start + bytes.length) continue;
            queue.push([
                id,
                bytes.subarray(c.off - start, c.off - start + c.len)
            ]);
            inflight[id] = 1;
        }
        if (!pumping) {
            pumping = true;
            mc.port2.postMessage(0);
        }
    };
    const fetchChunks = (ids, gap = GAP, priority = 'high')=>{
        const todo = ids.filter((id)=>!loaded[id] && !inflight[id]);
        const g = gen;
        for (const r of ranges(terr, todo, gap)){
            for (const id of r.ids)inflight[id] = 1;
            read(r.start, r.end, priority).then((b)=>ingest(r.start, b, g), ()=>{
                if (g === gen) for (const id of r.ids)inflight[id] = 0;
                else net.aborted++;
            });
        }
    };
    let orbitKey = '', orbitIds = [], restTimer = 0;
    const prefetchOrbit = ()=>{
        const key = [
            cam.tx,
            cam.ty,
            cam.tz,
            cam.pitch,
            cam.dist,
            tau
        ].map(Math.round).join();
        if (key === orbitKey) return orbitIds;
        const ids = new Set();
        for(let a = 0; a < 360; a += 2){
            const v1 = makeView({
                ...cam,
                yaw: a
            }, canvas.width, canvas.height, ground);
            for (const id of select(terr, v1, tau, ()=>true).want)ids.add(id);
        }
        orbitKey = key;
        orbitIds = [
            ...ids
        ];
        fetchChunks(orbitIds, GAP, 'low');
        return orbitIds;
    };
    const cam = {
        ...VIEWS.default
    };
    let tau = TAU, pending = false, view, sel;
    let settle = [];
    const ground = (x, y)=>groundMax(terr, x, y);
    const spin = {
        vy: 0,
        vp: 0,
        t0: 0,
        last: 0
    };
    const LEAD = Number(new URLSearchParams(location.search).get('lead') ?? 250);
    const motion = {
        t: 0,
        c: null,
        v: [
            0,
            0,
            0,
            0,
            0
        ]
    };
    const lookAhead = (now)=>{
        const prev = motion.c, dt = now - motion.t;
        motion.c = {
            ...cam
        };
        motion.t = now;
        if (!prev || dt <= 0 || dt > 200 || !LEAD) {
            motion.v.fill(0);
            return;
        }
        const d = [
            cam.yaw - prev.yaw,
            cam.pitch - prev.pitch,
            Math.log(cam.dist / prev.dist),
            cam.tx - prev.tx,
            cam.ty - prev.ty
        ];
        for(let i = 0; i < 5; i++)motion.v[i] = 0.5 * motion.v[i] + 0.5 * (d[i] / dt);
        if (motion.v.every((v1)=>v1 === 0)) return;
        const [vy, vp, vd, vx, vt] = motion.v.map((v1)=>v1 * LEAD);
        const ahead = {
            ...cam,
            yaw: cam.yaw + vy,
            pitch: Math.min(89, Math.max(8, cam.pitch + vp)),
            dist: Math.min(100000, Math.max(6000, cam.dist * Math.exp(vd))),
            tx: Math.min(HALF, Math.max(-HALF, cam.tx + vx)),
            ty: Math.min(HALF, Math.max(-HALF, cam.ty + vt))
        };
        fetchChunks(select(terr, makeView(ahead, canvas.width, canvas.height, ground), tau, ()=>true).want, GAP, 'low');
    };
    function frame() {
        pending = false;
        const now = performance.now();
        if (spin.t0) {
            const f = 1 - (now - spin.t0) / 300, dt = now - spin.last;
            spin.last = now;
            if (f <= 0) spin.t0 = 0;
            else {
                cam.yaw += spin.vy * dt * f;
                cam.pitch = Math.min(89, Math.max(8, cam.pitch + spin.vp * dt * f));
            }
        }
        const t0 = performance.now();
        view = makeView(cam, canvas.width, canvas.height, ground);
        sel = select(terr, view, tau, (id)=>loaded[id] === 1);
        wanted.fill(0);
        for (const id of sel.want)wanted[id] = 1;
        fetchChunks(sel.want);
        lookAhead(now);
        stats.selectMs = performance.now() - t0;
        renderer.draw(terr, view, sel.draw);
        stats.frames++;
        const sync = ()=>gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        if (!stats.coarse && sel.uncovered === 0 && sel.draw.length) {
            stats.coarseDrawAt = t0;
            sync();
            stats.coarse = performance.now();
            stats.coarseDraw = sel.draw.map((id)=>terr.chunks[id].k);
        }
        if (sel.want.every((id)=>loaded[id])) {
            if (!stats.complete) {
                sync();
                stats.complete = performance.now();
                stats.completeNet = {
                    requests: net.requests,
                    bytes: net.bytes
                };
            }
            clearTimeout(restTimer);
            if (prefetch) restTimer = setTimeout(prefetchOrbit, 300);
            const s = settle;
            settle = [];
            for (const f of s)f();
        }
        if (spin.t0) render();
    }
    const render = ()=>{
        if (!pending) {
            pending = true;
            requestAnimationFrame(frame);
        }
    };
    async function loadPhotos() {
        const status = document.getElementById('photo-status');
        const archive = await openArchive();
        const tileX = terr.x0 / PHOTO_SIZE, tileY = terr.y0 / PHOTO_SIZE;
        if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) throw new Error('標高と写真の格子が一致しません');
        let done = 0;
        await Promise.all(Array.from({
            length: 6
        }, async (_, worker)=>{
            for(let cell = worker; cell < PHOTO_SIDE * PHOTO_SIDE; cell += 6){
                const col = cell % PHOTO_SIDE, row = Math.floor(cell / PHOTO_SIDE);
                const bytes = await archive.tile(PHOTO_Z, tileX + col, tileY + row);
                if (!bytes) throw new Error(`写真タイルがありません: ${PHOTO_Z}/${tileX + col}/${tileY + row}`);
                const bitmap = await createImageBitmap(new Blob([
                    Uint8Array.from(bytes)
                ], {
                    type: 'image/jpeg'
                }));
                if (bitmap.width !== PHOTO_SIZE || bitmap.height !== PHOTO_SIZE) throw new Error('写真タイルの寸法が違います');
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, photoTex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, col * PHOTO_SIZE, row * PHOTO_SIZE, gl.RGB, gl.UNSIGNED_BYTE, bitmap);
                bitmap.close();
                if (gl.getError() !== gl.NO_ERROR) throw new Error('写真テクスチャの GPU 転送に失敗しました');
                status.textContent = `写真 ${++done} / ${PHOTO_SIDE * PHOTO_SIDE} 枚を読み込み中`;
            }
        }));
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, photoTex);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('写真テクスチャの縮小画像を作れません');
        photoReady = true;
        status.textContent = '写真と地形を表示中';
        render();
    }
    loadPhotos().catch((error)=>{
        document.getElementById('photo-status').textContent = `写真を読み込めません: ${String(error)}`;
    });
    let drag = null;
    canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
    canvas.addEventListener('pointerdown', (e)=>{
        drag = {
            x: e.clientX,
            y: e.clientY,
            t: e.timeStamp,
            pan: e.button === 2 || e.shiftKey
        };
        spin.t0 = 0;
        spin.vy = spin.vp = 0;
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, e.timeStamp - drag.t);
        if (drag.pan) {
            const m = cam.dist * 2 * Math.tan(FOV_Y * Math.PI / 360) / canvas.clientHeight, a = cam.yaw * Math.PI / 180;
            const cl = (v1)=>Math.min(HALF, Math.max(-HALF, v1));
            cam.tx = cl(cam.tx - (dx * Math.cos(a) - dy * Math.sin(a)) * m);
            cam.ty = cl(cam.ty + (dx * Math.sin(a) + dy * Math.cos(a)) * m);
        } else {
            const dYaw = -dx * 0.3, p = Math.min(89, Math.max(8, cam.pitch + dy * 0.2));
            spin.vy = 0.5 * spin.vy + 0.5 * (dYaw / dt);
            spin.vp = 0.5 * spin.vp + 0.5 * ((p - cam.pitch) / dt);
            cam.yaw += dYaw;
            cam.pitch = p;
        }
        drag = {
            ...drag,
            x: e.clientX,
            y: e.clientY,
            t: e.timeStamp
        };
        render();
    });
    canvas.addEventListener('pointerup', (e)=>{
        if (drag && !drag.pan && e.timeStamp - drag.t < 50 && (spin.vy || spin.vp)) {
            spin.t0 = spin.last = performance.now();
            render();
        }
        drag = null;
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        cam.dist = Math.min(100000, Math.max(6000, cam.dist * Math.exp(e.deltaY * 0.0015 * (e.deltaMode === 1 ? 40 : 1))));
        render();
    }, {
        passive: false
    });
    new ResizeObserver(()=>{
        size();
        render();
    }).observe(canvas);
    async function open() {
        const g = gen, b = await read(0, FIRST_BYTES);
        terr = parseTerr(b);
        ingest(0, b, g);
    }
    ingest(0, await first, gen);
    await new Promise((r)=>{
        settle.push(r);
        render();
    });
    return {
        gl,
        canvas,
        cam,
        net,
        stats,
        hooks,
        renderer,
        loaded,
        get terr () {
            return terr;
        },
        get view () {
            return view;
        },
        get sel () {
            return sel;
        },
        set tau (v){
            tau = v;
        },
        get tau () {
            return tau;
        },
        get spinning () {
            return spin.t0 !== 0;
        },
        render,
        frame,
        open,
        prefetchOrbit,
        fetchChunks,
        settled: ()=>new Promise((r)=>{
                settle.push(r);
                render();
            }),
        reset () {
            gen++;
            abort.abort();
            abort = new AbortController();
            loaded.fill(0);
            inflight.fill(0);
            queue.length = 0;
            net.requests = net.bytes = 0;
            orbitKey = '';
            motion.c = null;
        }
    };
}
await mount(document.getElementById('map'));
