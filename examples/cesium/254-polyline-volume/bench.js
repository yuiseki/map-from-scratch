import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.js';
import { JAPAN, FUJI, project, onNearSide, FOV_Y } from './camera.js';
import { toEcef } from './land.js';
import { LINES, hexToRgb } from './lines.js';
import { TUBE_RADIUS_KM, MITRE_LIMIT } from './tubes.js';
import { pulseHead } from './pulse.js';
const frameEnd = ()=>new Promise((r)=>requestAnimationFrame(r));
export async function run(app) {
    const { renderer, state, meta } = app;
    const gl = renderer.gl, canvas = gl.canvas;
    canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webgl context lost'
        }));
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, dpr = W / canvas.clientWidth;
    const check = (id, pass, detail)=>emit({
            check: id,
            pass,
            detail
        });
    emit({
        metric: 'first_frame_ms',
        value: app.firstFrame()
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            canvas: [
                W,
                H
            ],
            dpr,
            lines: meta.lines.map((l)=>`${l.en} ${l.km} km ${l.points} pts ${l.speed_kmh} km/h`)
        }
    });
    const colours = LINES.map((l)=>hexToRgb(l.colour));
    const setStyle = (shape, corner)=>{
        if (state.shape !== shape || state.corner !== corner) {
            state.shape = shape;
            state.corner = corner;
            app.rebuild();
        }
    };
    const shot = (cam, t = 0, pulse = false)=>{
        state.cam = {
            ...cam
        };
        state.pulse = pulse;
        app.draw(t);
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
    };
    const at = (img, x, y)=>{
        const i = ((H - 1 - y) * W + x) * 4;
        return [
            img[i],
            img[i + 1],
            img[i + 2]
        ];
    };
    const lum = (c)=>0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const tubeOf = (c, line)=>{
        const k = colours[line], m = Math.max(...c);
        if (m < 80) return false;
        const cos = (c[0] * k[0] + c[1] * k[1] + c[2] * k[2]) / (Math.hypot(...c) * Math.hypot(...k));
        return cos > 0.95;
    };
    const anyTube = (c)=>colours.some((_, i)=>tubeOf(c, i));
    const screen = (cam, lon, lat)=>{
        const p = toEcef(lon, lat, 0);
        if (!onNearSide(cam, p)) return null;
        const s = project(cam, canvas.clientWidth, canvas.clientHeight, p);
        return s ? [
            Math.floor(s[0] * dpr),
            Math.floor(s[1] * dpr)
        ] : null;
    };
    const inside = (s)=>!!s && s[0] >= 0 && s[1] >= 0 && s[0] < W && s[1] < H;
    const search = (img, s, r, pred)=>{
        for(let dy = -r; dy <= r; dy++)for(let dx = -r; dx <= r; dx++){
            const x = s[0] + dx, y = s[1] + dy;
            if (x >= 0 && y >= 0 && x < W && y < H && pred(at(img, x, y))) return true;
        }
        return false;
    };
    setStyle('circle', 'round');
    {
        const img = shot(JAPAN);
        const r = Math.ceil(3 * dpr);
        const res = meta.stations.map((s)=>{
            const p = screen(JAPAN, s.lon, s.lat);
            return {
                st: s.en,
                m: s.m_from_line,
                on: inside(p),
                hit: inside(p) && search(img, p, r, (c)=>tubeOf(c, s.line))
            };
        });
        const visible = res.filter((x)=>x.on);
        check('tube-at-stations', visible.length >= 12 && visible.every((x)=>x.hit), {
            visible: visible.length,
            missed: visible.filter((x)=>!x.hit).map((x)=>x.st)
        });
        const sea = [
            [
                134,
                40
            ],
            [
                139.5,
                33
            ],
            [
                131,
                37.5
            ]
        ].map(([lon, lat])=>at(img, ...screen(JAPAN, lon, lat)));
        const landPts = [
            [
                142.8,
                43.5
            ],
            [
                127.8,
                36.5
            ],
            [
                137.3,
                35.9
            ],
            [
                131.2,
                34.2
            ]
        ].map(([lon, lat])=>at(img, ...screen(JAPAN, lon, lat)));
        const seaL = Math.max(...sea.map(lum)), landL = Math.min(...landPts.map(lum));
        check('base-map-visible', landL > seaL + 6 && sea.every((c)=>c[2] > c[0] && !anyTube(c)) && landPts.every((c)=>!anyTube(c)) && seaL > 2, {
            sea: sea.map((c)=>c.join(',')),
            land: landPts.map((c)=>c.join(',')),
            sea_max_lum: +seaL.toFixed(1),
            land_min_lum: +landL.toFixed(1)
        });
    }
    {
        const close = {
            lon: 138.62,
            lat: 35.13,
            range: 18,
            heading: 0,
            tilt: 60 * Math.PI / 180
        };
        const sf = meta.stations.find((s)=>s.en === 'Shin-Fuji');
        const c = screen(close, sf.lon, sf.lat);
        const half = Math.round(220 * dpr);
        const masks = {};
        for (const shape of [
            'circle',
            'box',
            'star'
        ]){
            setStyle(shape, 'round');
            const img = shot(close);
            const m = new Uint8Array((2 * half) ** 2);
            for(let y = 0; y < 2 * half; y++)for(let x = 0; x < 2 * half; x++){
                const X = c[0] - half + x, Y = c[1] - half + y;
                if (X >= 0 && Y >= 0 && X < W && Y < H) m[y * 2 * half + x] = tubeOf(at(img, X, Y), sf.line) ? 1 : 0;
            }
            masks[shape] = m;
        }
        const count = (m)=>m.reduce((s, v)=>s + v, 0);
        const diff = (a, b)=>{
            let x = 0, u = 0;
            for(let i = 0; i < a.length; i++){
                x += a[i] ^ b[i];
                u += a[i] | b[i];
            }
            return u ? x / u : 0;
        };
        const pairs = {
            circle_box: diff(masks.circle, masks.box),
            circle_star: diff(masks.circle, masks.star),
            box_star: diff(masks.box, masks.star)
        };
        const counts = {
            circle: count(masks.circle),
            box: count(masks.box),
            star: count(masks.star)
        };
        check('shape-changes-silhouette', Object.values(pairs).every((d)=>d > 0.08) && Object.values(counts).every((n)=>n > 2000), {
            xor_over_union: Object.fromEntries(Object.entries(pairs).map(([k, v])=>[
                    k,
                    +v.toFixed(3)
                ])),
            tube_px: counts
        });
    }
    {
        let best = {
            a: 0,
            line: 0,
            i: 0
        };
        app.lines.forEach((l, li)=>{
            for(let i = 1; i + 1 < l.length / 2; i++){
                const c = Math.cos(l[2 * i + 1] * Math.PI / 180);
                const ax = (l[2 * i] - l[2 * i - 2]) * c, ay = l[2 * i + 1] - l[2 * i - 1], bx = (l[2 * i + 2] - l[2 * i]) * c, by = l[2 * i + 3] - l[2 * i + 1];
                const a = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / Math.hypot(ax, ay) / Math.hypot(bx, by))));
                if (a > best.a) best = {
                    a,
                    line: li,
                    i
                };
            }
        });
        const l = app.lines[best.line], P = (k)=>[
                l[2 * k],
                l[2 * k + 1]
            ];
        const cam = {
            lon: P(best.i)[0],
            lat: P(best.i)[1],
            range: 14,
            heading: 0,
            tilt: 0
        };
        const pxPerKm = H / (2 * Math.tan(FOV_Y / 2) * cam.range);
        const rPx = TUBE_RADIUS_KM * pxPerKm;
        const detail = {
            bend_deg: +(best.a * 180 / Math.PI).toFixed(1),
            line: LINES[best.line].en,
            at: P(best.i).map((v)=>+v.toFixed(4)),
            radius_px: +rPx.toFixed(1)
        };
        let pass = true;
        for (const corner of [
            'round',
            'mitre'
        ]){
            setStyle('circle', corner);
            const img = shot(cam);
            const pts = [
                P(best.i - 1),
                P(best.i),
                P(best.i + 1)
            ].map(([lon, lat])=>screen(cam, lon, lat));
            let gaps = 0, samples = 0;
            for (const [a, b] of [
                [
                    pts[0],
                    pts[1]
                ],
                [
                    pts[1],
                    pts[2]
                ]
            ]){
                const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
                for(let k = 0; k <= n; k++){
                    const s = [
                        Math.round(a[0] + (b[0] - a[0]) * k / n),
                        Math.round(a[1] + (b[1] - a[1]) * k / n)
                    ];
                    if (!inside(s) || Math.hypot(s[0] - pts[1][0], s[1] - pts[1][1]) > 1.5 * pxPerKm) continue;
                    samples++;
                    if (!search(img, s, 1, (c)=>tubeOf(c, best.line))) gaps++;
                }
            }
            const segs = [];
            for(let k = 0; k + 1 < l.length / 2; k++){
                const a = screen(cam, ...P(k)), b = screen(cam, ...P(k + 1));
                if (a && b && (inside(a) || inside(b) || Math.hypot(a[0] - W / 2, a[1] - H / 2) < 2 * W)) segs.push([
                    a,
                    b
                ]);
            }
            const dist = (x, y)=>Math.min(...segs.map(([a, b])=>{
                    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
                    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
                    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
                }));
            const limit = rPx * MITRE_LIMIT + 3;
            let spikes = 0, tube = 0, worst = 0;
            const box = Math.round(3 * pxPerKm);
            for(let y = Math.max(0, pts[1][1] - box); y < Math.min(H, pts[1][1] + box); y++)for(let x = Math.max(0, pts[1][0] - box); x < Math.min(W, pts[1][0] + box); x++){
                if (!tubeOf(at(img, x, y), best.line)) continue;
                tube++;
                const d = dist(x, y);
                worst = Math.max(worst, d);
                if (d > limit) spikes++;
            }
            detail[corner] = {
                samples,
                gaps,
                tube_px: tube,
                spikes,
                worst_px: +worst.toFixed(1),
                limit_px: +limit.toFixed(1)
            };
            pass &&= samples > 20 && gaps === 0 && spikes === 0 && tube > 0;
        }
        check('sharp-bend-joined', pass, detail);
    }
    setStyle('circle', 'round');
    {
        const tok = 0, speed = meta.lines[tok].speed_kmh;
        const m = app.mesh();
        const len = Math.max(...m.ringAlong.filter((_, r)=>m.ringLine[r] === tok));
        const t = (200 + 40) / (speed * 360 / 3600);
        const head = pulseHead(t, speed, len);
        let ring = 0;
        for(let r = 0; r < m.ringLine.length; r++)if (m.ringLine[r] === tok && Math.abs(m.ringAlong[r] - head) < Math.abs(m.ringAlong[ring] - head)) ring = r;
        const pc = m.frameCentre.slice(ring * 3, ring * 3 + 3);
        const lon = Math.atan2(pc[1], pc[0]) * 180 / Math.PI, lat = Math.asin(pc[2] / Math.hypot(pc[0], pc[1], pc[2])) * 180 / Math.PI;
        const cam = {
            lon,
            lat,
            range: 120,
            heading: 0,
            tilt: 0
        };
        const s = screen(cam, lon, lat);
        const on = at(shot(cam, t, true), s[0], s[1]), off = at(shot(cam, t, false), s[0], s[1]);
        check('pulse-at-head', lum(on) > lum(off) + 30, {
            head_km: +head.toFixed(1),
            on: on.join(','),
            off: off.join(',')
        });
    }
    {
        state.cam = {
            ...JAPAN,
            range: 900,
            lon: 139.5,
            lat: 35.7
        };
        app.draw(0);
        const tokyo = meta.stations.find((s)=>s.en === 'Tokyo');
        const before = project(state.cam, canvas.clientWidth, canvas.clientHeight, toEcef(tokyo.lon, tokyo.lat, 0));
        const r = canvas.getBoundingClientRect(), x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
        const ev = (type, x, y)=>canvas.dispatchEvent(new PointerEvent(type, {
                clientX: x,
                clientY: y,
                pointerId: 1,
                button: 0,
                bubbles: true
            }));
        ev('pointerdown', x0, y0);
        ev('pointermove', x0 + 120, y0 + 60);
        ev('pointerup', x0 + 120, y0 + 60);
        const after = project(state.cam, canvas.clientWidth, canvas.clientHeight, toEcef(tokyo.lon, tokyo.lat, 0));
        const d = [
            after[0] - before[0],
            after[1] - before[1]
        ];
        check('drag-follows-pointer', Math.abs(d[0] - 120) < 8 && Math.abs(d[1] - 60) < 8, {
            moved_css_px: d.map((v)=>+v.toFixed(1))
        });
    }
    {
        state.cam = {
            ...JAPAN
        };
        document.getElementById('fuji').click();
        const t0 = performance.now();
        while(performance.now() - t0 < 4200)await frameEnd();
        const cam = {
            ...state.cam
        };
        const same = Object.keys(FUJI).every((k)=>Math.abs(cam[k] - FUJI[k]) < 1e-9);
        const img = shot(cam);
        const sf = meta.stations.find((s)=>s.en === 'Shin-Fuji'), s = screen(cam, sf.lon, sf.lat);
        let run = 0;
        for(let y = Math.max(0, s[1] - 150); y < Math.min(H, s[1] + 150); y++)if (tubeOf(at(img, s[0], y), sf.line)) run++;
        check('fly-to-fuji', same && inside(s) && run > 12 * dpr, {
            cam_reached: same,
            shin_fuji_px: s,
            tube_px_in_column: run
        });
    }
    setStyle('circle', 'round');
    state.pulse = true;
    await benchFrames(gl, 120, (i)=>{
        state.cam = {
            ...JAPAN,
            lon: JAPAN.lon + 6 * Math.sin(i / 120 * 2 * Math.PI),
            lat: JAPAN.lat + 2 * Math.sin(i / 60 * Math.PI)
        };
        app.draw(i / 60);
    });
    await benchFrames(gl, 60, (i)=>{
        state.cam = {
            ...JAPAN
        };
        app.draw(i / 60);
    }, {
        prefix: 'japan_'
    });
    await benchFrames(gl, 60, (i)=>{
        state.cam = {
            ...FUJI
        };
        app.draw(i / 60);
    }, {
        prefix: 'fuji_'
    });
    const tris = [], rebuild = [];
    for (const shape of [
        'circle',
        'box',
        'star'
    ])for (const corner of [
        'round',
        'mitre'
    ]){
        const t0 = performance.now();
        setStyle(shape, corner);
        rebuild.push(performance.now() - t0);
        tris.push(renderer.triangles);
    }
    emit({
        metric: 'triangles',
        value: Math.max(...tris)
    });
    emit({
        metric: 'rebuild_ms',
        values: rebuild
    });
    emit({
        info: {
            triangles_by_style: tris
        }
    });
    setStyle('circle', 'round');
    emit({
        done: true
    });
}
