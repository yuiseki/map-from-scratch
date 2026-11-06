import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.js';
import { eyeOf, horizonY, CLEARANCE, MIN_DIST, MAX_DIST, MAX_PITCH } from './camera.js';
import { hexToRgb, NO_SKY } from './sky.js';
const dist = (a, b)=>Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rgb255 = (hex)=>hexToRgb(hex).map((v)=>v * 255);
const frame = ()=>new Promise(requestAnimationFrame);
export async function run(p) {
    const { gl, ui } = p;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webglcontextlost'
        }));
    emit({
        info: {
            gpu: glRenderer(gl),
            triangles: p.triangles,
            dpr: devicePixelRatio
        }
    });
    emit({
        metric: 'first_frame_ms',
        value: p.firstFrame
    });
    const W = gl.canvas.width, H = gl.canvas.height, dpr = devicePixelRatio;
    const buf = new Uint8Array(W * H * 4);
    const snap = ()=>{
        p.draw();
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const copy = buf.slice();
        return (x, y)=>{
            const i = ((H - 1 - Math.min(H - 1, Math.round(y * dpr))) * W + Math.min(W - 1, Math.round(x * dpr))) * 4;
            return [
                copy[i],
                copy[i + 1],
                copy[i + 2]
            ];
        };
    };
    const cssW = W / dpr, cssH = H / dpr;
    const set = (el, v)=>{
        if (typeof v === 'boolean') el.checked = v;
        else el.value = v;
    };
    const defaults = Object.fromEntries(Object.entries(ui).map(([k, el])=>[
            k,
            el.type === 'checkbox' ? el.checked : el.value
        ]));
    const reset = ()=>{
        for (const [k, v] of Object.entries(defaults))set(ui[k], v);
    };
    const cam0 = p.getCam();
    const hy = horizonY(cam0.pitch, cssH);
    const eyeZ = eyeOf(cam0)[2];
    emit({
        info: {
            pitch: cam0.pitch,
            horizon_css_y: hy,
            eye_m: eyeZ
        }
    });
    set(ui.enabled, false);
    const bare = snap();
    reset();
    const white = rgb255(NO_SKY);
    const isTerrain = (x, y)=>dist(bare(x, y), white) > 20;
    const r1 = (v)=>Math.round(v * 10) / 10;
    {
        const sky = rgb255(ui.skyColor.value), hor = rgb255(ui.horizonColor.value);
        const def = snap();
        set(ui.skyHorizonBlend, '0.1');
        const narrow = snap();
        reset();
        let worst = 0, nearer = 0, n = 0;
        for(let x = 4; x < cssW; x += cssW / 32)for (const y of [
            1,
            3,
            5
        ]){
            n++;
            worst = Math.max(worst, dist(narrow(x, y), sky));
            if (dist(def(x, y), sky) < dist(def(x, y), hor)) nearer++;
        }
        emit({
            check: 'top-rows-sky-color',
            pass: worst <= 6 && nearer === n && hy > 45,
            detail: `band 0.1: worst distance to sky ${r1(worst)}; band 0.5: ${nearer}/${n} nearer sky than horizon; horizon y ${r1(hy)} px`
        });
    }
    {
        const at = snap(), hor = rgb255(ui.horizonColor.value);
        let ok = 0, n = 0, worst = 0;
        for(let x = 4; x < cssW; x += cssW / 64){
            const d = dist(at(x, hy - 2), hor);
            n++;
            if (d <= 12) ok++;
            worst = Math.max(worst, d);
        }
        emit({
            check: 'horizon-row-horizon-color',
            pass: eyeZ > 3700 && ok / n >= 0.95,
            detail: `${ok}/${n} within 12, worst ${r1(worst)}, eye ${Math.round(eyeZ)} m`
        });
    }
    {
        set(ui.fogColor, '#ff0000');
        set(ui.horizonColor, '#ff0000');
        const at = snap(), red = [
            255,
            0,
            0
        ];
        const band = (y0, y1, terrainOnly)=>{
            let s = 0, n = 0;
            for(let x = 4; x < cssW; x += cssW / 64)for(let y = y0; y < y1; y += 0.01 * cssH){
                if (terrainOnly && !isTerrain(x, y)) continue;
                s += dist(at(x, y), red);
                n++;
            }
            return [
                n ? s / n : Infinity,
                n
            ];
        };
        const [dA, nA] = band(hy + 2, hy + 0.1 * cssH, true);
        const [dB, nB] = band(hy + 0.1 * cssH, hy + 0.25 * cssH, true);
        const [dN, nN] = band(cssH - 0.03 * cssH, cssH - 1, false);
        emit({
            check: 'distant-terrain-fog-color',
            pass: nA >= 50 && nB >= 50 && dA < dB && dB < dN && dA < 0.5 * dN,
            detail: `mean distance to the red fog: band A ${r1(dA)} (${nA} px), band B ${r1(dB)} (${nB} px), bottom ${r1(dN)} (${nN} px)`
        });
        reset();
    }
    {
        set(ui.skyHorizonBlend, '0.1');
        const bandPx = 0.1 * cssH / 2;
        const base = snap();
        const pts = [];
        for(let x = 4; x < cssW; x += cssW / 40){
            for(let y = 2; y < hy - bandPx - 4; y += (hy - bandPx - 6) / 6)pts.push({
                x,
                y,
                r: 'top'
            });
            for(let y = hy - bandPx + 4; y < hy - 3; y += (bandPx - 7) / 4)pts.push({
                x,
                y,
                r: 'band'
            });
            for(let y = hy + 2; y < hy + 0.25 * cssH; y += 0.015 * cssH)if (isTerrain(x, y)) pts.push({
                x,
                y,
                r: 'fogged'
            });
            for(let y = cssH - 0.03 * cssH; y < cssH - 1; y += 4)pts.push({
                x,
                y,
                r: 'near'
            });
        }
        const cases = [
            {
                id: 'sky-color',
                el: ui.skyColor,
                v: '#ff00ff',
                change: [
                    'top',
                    'band'
                ],
                keep: [
                    'fogged',
                    'near'
                ]
            },
            {
                id: 'horizon-color',
                el: ui.horizonColor,
                v: '#ff8000',
                change: [
                    'band',
                    'fogged'
                ],
                keep: [
                    'top',
                    'near'
                ]
            },
            {
                id: 'fog-color',
                el: ui.fogColor,
                v: '#00ff00',
                change: [
                    'fogged'
                ],
                keep: [
                    'top',
                    'band',
                    'near'
                ]
            },
            {
                id: 'sky-horizon-blend',
                el: ui.skyHorizonBlend,
                v: '0.6',
                change: [
                    'band'
                ],
                keep: [
                    'fogged',
                    'near'
                ]
            },
            {
                id: 'horizon-fog-blend',
                el: ui.horizonFogBlend,
                v: '0.95',
                change: [
                    'fogged'
                ],
                keep: [
                    'top',
                    'band',
                    'near'
                ]
            },
            {
                id: 'fog-ground-blend',
                el: ui.fogGroundBlend,
                v: '0.6',
                change: [
                    'fogged'
                ],
                keep: [
                    'top',
                    'band',
                    'near'
                ]
            }
        ];
        const lines = [];
        let all = true;
        for (const c of cases){
            const old = c.el.value;
            set(c.el, c.v);
            const at = snap();
            set(c.el, old);
            const changed = {}, total = {};
            for (const q of pts){
                total[q.r] = (total[q.r] ?? 0) + 1;
                if (dist(at(q.x, q.y), base(q.x, q.y)) > 3) changed[q.r] = (changed[q.r] ?? 0) + 1;
            }
            const pass = c.change.every((r)=>total[r] > 0 && (changed[r] ?? 0) / total[r] >= 0.3) && c.keep.every((r)=>(changed[r] ?? 0) === 0);
            all &&= pass;
            lines.push(`${c.id} ${pass ? 'ok' : 'FAIL'} [${Object.keys(total).map((r)=>`${r} ${changed[r] ?? 0}/${total[r]}`).join(', ')}]`);
        }
        emit({
            check: 'controls-change-only-their-pixels',
            pass: all,
            detail: lines.join('; ')
        });
        reset();
    }
    {
        const on = snap();
        set(ui.enabled, false);
        const off = snap();
        reset();
        const bg = rgb255(NO_SKY);
        let skyChanged = 0, skyBg = 0, n = 0, fogGone = 0, m = 0;
        for(let x = 4; x < cssW; x += cssW / 32){
            for (const y of [
                2,
                hy / 2,
                hy - 3
            ]){
                n++;
                if (dist(on(x, y), off(x, y)) > 30) skyChanged++;
                if (dist(off(x, y), bg) <= 6) skyBg++;
            }
            m++;
            if (dist(on(x, hy + 0.05 * cssH), off(x, hy + 0.05 * cssH)) > 10) fogGone++;
        }
        emit({
            check: 'sky-disabled-changes-sky',
            pass: skyChanged / n >= 0.95 && skyBg / n >= 0.95 && fogGone / m >= 0.5,
            detail: `sky changed ${skyChanged}/${n}, background ${skyBg}/${n}, fog gone ${fogGone}/${m}`
        });
    }
    {
        const ms = [];
        let ok = 0;
        const els = [
            ui.skyColor,
            ui.horizonColor,
            ui.fogColor,
            ui.skyHorizonBlend,
            ui.horizonFogBlend,
            ui.fogGroundBlend,
            ui.enabled
        ];
        const vals = [
            '#ff00ff',
            '#ff8000',
            '#00ff00',
            '0.9',
            '0.05',
            '0.6',
            false
        ];
        for(let i = 0; i < els.length; i++){
            await frame();
            gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            const before = buf.slice();
            const t0 = performance.now();
            set(els[i], vals[i]);
            els[i].dispatchEvent(new Event('input'));
            await frame();
            gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            ms.push(performance.now() - t0);
            let diff = 0;
            for(let k = 0; k < buf.length; k += 4 * 97)if (Math.abs(buf[k] - before[k]) + Math.abs(buf[k + 1] - before[k + 1]) + Math.abs(buf[k + 2] - before[k + 2]) > 6) diff++;
            if (diff > 20) ok++;
            reset();
        }
        p.draw();
        emit({
            metric: 'control_redraw_ms',
            values: ms
        });
        emit({
            check: 'controls-redraw-next-frame',
            pass: ok === els.length,
            detail: `${ok}/${els.length} inputs redrawn`
        });
    }
    {
        let worst = Infinity;
        const c0 = p.getCam();
        for(let b = 0; b < 360; b += 15){
            p.setCam({
                ...c0,
                bearing: b,
                pitch: MAX_PITCH,
                distance: MIN_DIST
            });
            for (const d of [
                MIN_DIST,
                2000,
                5000,
                MAX_DIST
            ]){
                p.setCam({
                    ...p.getCam(),
                    distance: d,
                    pitch: MAX_PITCH
                });
                const e = eyeOf(p.getCam()), g = p.ground(e[0], e[1]) ?? 0;
                worst = Math.min(worst, e[2] - g);
            }
        }
        p.setCam(c0);
        emit({
            check: 'camera-above-terrain',
            pass: worst >= CLEARANCE - 1,
            detail: `worst clearance ${Math.round(worst)} m`
        });
    }
    {
        const c0 = p.getCam();
        await benchFrames(gl, 180, (i)=>{
            const u = i / 180;
            p.setCam({
                ...c0,
                bearing: (c0.bearing + 360 * u) % 360,
                pitch: 74 + 5 * Math.sin(2 * Math.PI * u),
                distance: c0.distance * (1 + 0.4 * Math.sin(4 * Math.PI * u))
            });
            p.draw();
        });
        p.setCam(c0);
        await benchFrames(gl, 60, ()=>p.draw(), {
            prefix: 'whole_'
        });
        p.draw();
    }
    await frame();
    emit({
        done: true
    });
}
