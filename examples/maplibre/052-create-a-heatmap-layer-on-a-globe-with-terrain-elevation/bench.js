import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.js';
import { project, unproject, limbPx, frame } from './camera.js';
import { RAMP, rampTexture } from './heat.js';
import { mercX, mercY } from './tiles.js';
import { jumpSteps } from './continuity.js';
const DATA = '../../../data/baked/maplibre-052-create-a-heatmap-layer-on-a-globe-with-terrain-elevation/';
export async function run(r, firstFrameMs, worldReady) {
    const gl = r.gl;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webglcontextlost'
        }));
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        info: {
            gpu: glRenderer(gl),
            points: r.points.count
        }
    });
    const truth = await (await fetch(DATA + 'truth.json')).json();
    await worldReady;
    const v = r.view, opening = {
        ...v
    };
    const set = (o)=>Object.assign(v, opening, o);
    const W = ()=>gl.drawingBufferWidth, H = ()=>gl.drawingBufferHeight;
    const read = (x, y, w, h)=>{
        x = Math.max(0, Math.round(x));
        y = Math.max(0, Math.round(y));
        w = Math.min(Math.round(w), W() - x);
        h = Math.min(Math.round(h), H() - y);
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(x, H() - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const flipped = new Uint8Array(px.length);
        for(let j = 0; j < h; j++)flipped.set(px.subarray((h - 1 - j) * w * 4, (h - j) * w * 4), j * w * 4);
        return {
            px: flipped,
            w,
            h
        };
    };
    const scr = (p, h = p.h)=>project(r.lastFrame, p.lon, p.lat, h);
    const ramp = rampTexture();
    const rampT = (c, o = 0)=>{
        let best = 1e9, t = 0;
        for(let i = 0; i < ramp.length / 4; i++){
            if (ramp[4 * i + 3] < 255) continue;
            const d = Math.abs(ramp[4 * i] - c[o]) + Math.abs(ramp[4 * i + 1] - c[o + 1]) + Math.abs(ramp[4 * i + 2] - c[o + 2]);
            if (d < best) {
                best = d;
                t = i / (ramp.length / 4 - 1);
            }
        }
        return {
            t,
            d: best
        };
    };
    set({
        lon: truth.dense.lon,
        lat: truth.dense.lat,
        zoom: 10,
        pitch: 60,
        bearing: 0
    });
    r.draw();
    {
        const [x, y] = scr({
            ...truth.dense,
            h: r.heightAt(truth.dense.lon, truth.dense.lat)
        });
        const { px } = read(x - 2, y - 2, 5, 5);
        let hot = 0, detail = '';
        for(let i = 0; i < 25; i++){
            const { t, d } = rampT(px, 4 * i);
            if (t >= 0.75 && d < 30) hot++;
            if (i === 12) detail = `centre rgb(${px[48]},${px[49]},${px[50]}) ramp t ${t.toFixed(2)} d ${d}`;
        }
        emit({
            check: 'hotspot-hot-end',
            pass: hot >= 13,
            detail: `${hot}/25 px at density >= 0.75 at (${x.toFixed(0)}, ${y.toFixed(0)}); ${detail}; top colour rgb(${RAMP[RAMP.length - 1].slice(1, 4)})`
        });
    }
    {
        set({});
        r.heatOn = 1;
        r.draw();
        const on = read(0, 0, W(), H()).px;
        r.heatOn = 0;
        r.draw();
        const off = read(0, 0, W(), H()).px;
        r.heatOn = 1;
        let heat = 0, hot = 0;
        const bands = [
            0,
            0,
            0,
            0,
            0
        ];
        for(let i = 0; i < on.length; i += 4){
            if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) <= 30) continue;
            heat++;
            const { t, d } = rampT(on, i);
            if (d >= 30) continue;
            bands[Math.min(4, Math.floor(t * 5))]++;
            if (t >= 0.8) hot++;
        }
        const share = hot / Math.max(1, heat), used = bands.filter((n)=>n > 0.03 * heat).length;
        emit({
            check: 'hot-end-share',
            pass: heat > 20000 && share < 0.15 && used >= 4,
            detail: `${heat} heat px in the opening view, ${(100 * share).toFixed(1)}% at density >= 0.8; per 0.2 band ${bands.map((n)=>(100 * n / Math.max(1, heat)).toFixed(1) + '%').join(' ')}`
        });
    }
    {
        set({
            lon: truth.empty.lon,
            lat: truth.empty.lat,
            zoom: 10,
            pitch: 60,
            bearing: 0
        });
        r.draw();
        const [x, y] = scr({
            ...truth.empty,
            h: r.heightAt(truth.empty.lon, truth.empty.lat)
        });
        const on = read(x - 2, y - 2, 5, 5).px, top = read(W() / 2, 2, 1, 1).px;
        r.heatOn = 0;
        r.draw();
        const off = read(x - 2, y - 2, 5, 5).px;
        set({
            lon: truth.dense.lon,
            lat: truth.dense.lat,
            zoom: 10,
            pitch: 60,
            bearing: 0
        });
        r.draw();
        const [dx, dy] = scr({
            ...truth.dense,
            h: r.heightAt(truth.dense.lon, truth.dense.lat)
        });
        const denseOff = read(dx, dy, 1, 1).px;
        r.heatOn = 1;
        r.draw();
        const denseOn = read(dx, dy, 1, 1).px;
        let diff = 0;
        for(let i = 0; i < on.length; i++)if (i % 4 !== 3) diff = Math.max(diff, Math.abs(on[i] - off[i]));
        const skyLike = Math.abs(on[48] - top[0]) + Math.abs(on[49] - top[1]) + Math.abs(on[50] - top[2]) < 20;
        const denseDiff = Math.abs(denseOn[0] - denseOff[0]) + Math.abs(denseOn[1] - denseOff[1]) + Math.abs(denseOn[2] - denseOff[2]);
        emit({
            check: 'empty-shows-terrain',
            pass: diff <= 3 && !skyLike && denseDiff > 60,
            detail: `empty max diff on/off ${diff}, rgb(${on[48]},${on[49]},${on[50]}), sky rgb(${top[0]},${top[1]},${top[2]}); hot spot on/off diff ${denseDiff}`
        });
    }
    {
        const keep = r.points;
        const p = {
            lon: truth.peak.lon,
            lat: truth.peak.lat - 0.025,
            h: 0
        };
        p.h = r.heightAt(p.lon, p.lat);
        const [west, north, east, south] = r.areaBounds();
        const u = (mercX(p.lon) - mercX(west)) / (mercX(east) - mercX(west)), vv = (mercY(p.lat) - mercY(north)) / (mercY(south) - mercY(north));
        r.setPoints({
            count: 1,
            firstYear: 2025,
            yearCounts: new Uint32Array([
                1
            ]),
            uv: new Uint16Array([
                Math.round(u * 65535),
                Math.round(vv * 65535)
            ])
        });
        const radius = r.radius, intensity = r.intensity, year = r.year;
        r.radius = 6;
        r.intensity = 3;
        r.year = 0;
        set({
            lon: p.lon,
            lat: p.lat - 0.04,
            zoom: 11,
            pitch: 65,
            bearing: 0
        });
        r.draw();
        const sTrue = scr(p), sFlat = scr(p, 0);
        const x0 = Math.min(sTrue[0], sFlat[0]) - 30, y0 = Math.min(sTrue[1], sFlat[1]) - 30;
        const win = read(x0, y0, Math.abs(sTrue[0] - sFlat[0]) + 60, Math.abs(sTrue[1] - sFlat[1]) + 60);
        let best = {
            t: -1,
            x: 0,
            y: 0
        };
        for(let j = 0; j < win.h; j++)for(let i = 0; i < win.w; i++){
            const k = 4 * (j * win.w + i), { t, d } = rampT(win.px, k);
            if (d < 30 && t > best.t) best = {
                t,
                x: x0 + i,
                y: y0 + j
            };
        }
        const shift = Math.hypot(sTrue[0] - sFlat[0], sTrue[1] - sFlat[1]);
        const toTrue = Math.hypot(best.x - sTrue[0], best.y - sTrue[1]), toFlat = Math.hypot(best.x - sFlat[0], best.y - sFlat[1]);
        emit({
            check: 'heat-on-slope-displaced',
            pass: shift > 25 && toTrue < 6 && toFlat > shift - 8 && best.t > 0.5,
            detail: `point at ${p.h.toFixed(0)} m; height shifts it ${shift.toFixed(1)} px; hottest pixel (t ${best.t.toFixed(2)}) ${toTrue.toFixed(1)} px from the terrain position, ${toFlat.toFixed(1)} px from the flat one`
        });
        r.setPoints(keep);
        r.radius = radius;
        r.intensity = intensity;
        r.year = year;
    }
    {
        set({
            lon: 140,
            lat: 39,
            zoom: 0.6,
            pitch: 0,
            bearing: 0
        });
        r.draw();
        const L = limbPx(v), cx = W() / 2, cy = H() / 2;
        const halo = [
            read(cx + L + 8, cy, 1, 1).px,
            read(cx - L - 8, cy, 1, 1).px
        ];
        const space = read(3, 3, 1, 1).px, inside = read(cx, cy, 1, 1).px;
        const ok = halo.every((c)=>c[2] > c[0] + 40 && c[2] - space[2] > 40);
        emit({
            check: 'limb-atmosphere',
            pass: ok && inside[2] < 250,
            detail: `limb ${L.toFixed(0)} px; halo rgb(${halo[0].slice(0, 3)}) / rgb(${halo[1].slice(0, 3)}); space rgb(${space.slice(0, 3)}); centre rgb(${inside.slice(0, 3)})`
        });
    }
    {
        set({
            lon: truth.dense.lon,
            lat: truth.dense.lat,
            zoom: 10,
            pitch: 60,
            bearing: 0
        });
        const heatPixels = (radius)=>{
            r.radius = radius;
            r.heatOn = 1;
            r.draw();
            const on = read(W() / 2 - 250, H() / 2 - 200, 500, 400).px;
            r.heatOn = 0;
            r.draw();
            const off = read(W() / 2 - 250, H() / 2 - 200, 500, 400).px;
            r.heatOn = 1;
            let n = 0;
            for(let i = 0; i < on.length; i += 4)if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) > 30) n++;
            return n;
        };
        const keep = r.radius;
        const small = heatPixels(10), large = heatPixels(30);
        r.radius = keep;
        emit({
            check: 'radius-changes-hot-area',
            pass: large > small * 1.4 && small > 50,
            detail: `heat pixels in 500x400 around Akita city: radius 10 -> ${small}, radius 30 -> ${large}`
        });
    }
    {
        const lum = ()=>{
            const { px } = read(0, 0, W(), H());
            const o = [];
            for(let i = 0; i < px.length; i += 4 * 37)o.push(px[i] + px[i + 1] + px[i + 2]);
            return o;
        };
        let prev = null;
        const diffs = [], zs = [];
        for(let z = 9; z >= 0.5; z -= 0.25){
            set({
                zoom: z
            });
            r.draw();
            const cur = lum();
            if (prev) {
                let s = 0;
                for(let i = 0; i < cur.length; i++)s += Math.abs(cur[i] - prev[i]);
                diffs.push(s / cur.length / 3);
                zs.push(z);
            }
            prev = cur;
        }
        const sorted = [
            ...diffs
        ].sort((a, b)=>a - b), med = sorted[sorted.length >> 1], max = sorted[sorted.length - 1];
        const jumps = jumpSteps(diffs);
        emit({
            check: 'zoom-out-continuous',
            pass: jumps.length === 0,
            detail: `steps changing > 2x both neighbours + 6: ${jumps.map((i)=>`zoom ${(zs[i] + 0.25).toFixed(2)} -> ${zs[i]} (${diffs[i].toFixed(1)})`).join(', ') || 'none'}; mean |dL| per 0.25 step: median ${med.toFixed(2)}, max ${max.toFixed(2)}; ${diffs.map((d, i)=>`${zs[i]}:${d.toFixed(1)}`).join(' ')}`
        });
    }
    {
        set({});
        r.draw();
        const c = gl.canvas, rect = c.getBoundingClientRect(), dpr = c.width / c.clientWidth;
        const ptr = (type, x, y)=>c.dispatchEvent(new PointerEvent(type, {
                clientX: rect.left + x,
                clientY: rect.top + y,
                pointerId: 1,
                bubbles: true
            }));
        const b0 = v.bearing, p0 = v.pitch;
        ptr('pointerdown', 300, 300);
        ptr('pointermove', 400, 300);
        ptr('pointermove', 400, 250);
        ptr('pointerup', 400, 250);
        const turned = v.bearing < b0 - 30, tilted = v.pitch > p0 + 5 || v.pitch === 80;
        const b1 = v.bearing, p1 = v.pitch;
        set({});
        const sx = 0.7 * c.clientWidth, sy = 0.7 * c.clientHeight;
        const g = unproject(frame(v), sx * dpr, sy * dpr, v.centerH);
        const z0 = v.zoom;
        c.dispatchEvent(new WheelEvent('wheel', {
            clientX: rect.left + sx,
            clientY: rect.top + sy,
            deltaY: -100,
            bubbles: true,
            cancelable: true
        }));
        const after = project(frame(v), g[0], g[1], v.centerH);
        const kept = Math.hypot(after[0] - sx * dpr, after[1] - sy * dpr);
        emit({
            check: 'drag-and-wheel',
            pass: turned && tilted && v.zoom > z0 && kept < 3,
            detail: `bearing ${b0.toFixed(1)} -> ${b1.toFixed(1)}, pitch ${p0} -> ${p1.toFixed(1)}; zoom ${z0} -> ${v.zoom.toFixed(2)}, ground under pointer moved ${kept.toFixed(2)} px`
        });
    }
    set({});
    await benchFrames(gl, 240, (i)=>{
        v.bearing = opening.bearing + i * 1.5;
        r.draw();
    });
    set({});
    await benchFrames(gl, 120, (i)=>{
        const t = i / 119;
        v.zoom = opening.zoom - (opening.zoom - 1) * (1 - Math.abs(2 * t - 1));
        r.draw();
    }, {
        prefix: 'zoom_'
    });
    const [west, north, east, south] = r.areaBounds();
    set({
        lon: (west + east) / 2,
        lat: (north + south) / 2,
        zoom: 7.6,
        pitch: 0,
        bearing: 0
    });
    await benchFrames(gl, 60, ()=>{
        r.invalidateHeat();
        r.draw();
    }, {
        prefix: 'whole_'
    });
    emit({
        metric: 'heat_passes',
        value: r.heatCalls
    });
    set({});
    r.draw();
    emit({
        done: true
    });
}
