import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.js';
import { project, unproject, limbRadiusPx } from './camera.js';
import { BG, OCEAN, AMBIENT } from './render.js';
import { ramp, scaleT, heightOf } from './ramp.js';
const emitCheck = (o)=>emit({
        ...o,
        detail: typeof o.detail === 'string' ? o.detail : JSON.stringify(o.detail)
    });
const near = (a, b, tol)=>Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
export async function run(map) {
    const { renderer, cam, rows, popMax, canvas } = map;
    const gl = renderer.gl;
    emit({
        info: {
            gpu: glRenderer(gl),
            countries: rows.length,
            lid_triangles: renderer.mesh.lidTriangles,
            wall_triangles: renderer.mesh.wallTriangles,
            ocean_triangles: renderer.mesh.oceanTriangles
        }
    });
    canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webglcontextlost'
        }));
    emit({
        metric: 'first_frame_ms',
        value: map.firstFrameMs
    });
    const W = ()=>gl.drawingBufferWidth, H = ()=>gl.drawingBufferHeight;
    const dpr = W() / canvas.clientWidth;
    const idOf = (a3)=>rows.findIndex((r)=>r[0] === a3);
    const hOf = (id)=>heightOf(rows[id][3], popMax);
    const block = (x, y, r = 2)=>{
        const w = 2 * r + 1, buf = new Uint8Array(w * w * 4);
        gl.readPixels(Math.round(x) - r, H() - 1 - Math.round(y) - r, w, w, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const out = [];
        for(let i = 0; i < w * w; i++)out.push([
            buf[4 * i],
            buf[4 * i + 1],
            buf[4 * i + 2]
        ]);
        return out;
    };
    const pixel = (x, y)=>block(x, y, 0)[0];
    const set = (lon, lat, dist, flat = false)=>{
        map.setFlat(flat, false);
        Object.assign(cam, {
            lon,
            lat,
            dist
        });
        renderer.hover = -1;
        map.draw();
    };
    const litFrom = (px, base)=>{
        const ks = [
            0,
            1,
            2
        ].filter((k)=>base[k] > 40).map((k)=>px[k] / base[k]);
        return ks.length > 0 && Math.max(...ks) - Math.min(...ks) < 0.08 && Math.min(...ks) > AMBIENT - 0.04 && Math.max(...ks) < 1.04;
    };
    set(30, 40, 4.5);
    await benchFrames(gl, 120, (i)=>{
        cam.lon = 30 + i * 3;
        cam.dist = 4.5 - 1.2 * Math.sin(i / 120 * Math.PI);
        renderer.draw(cam);
    });
    emit({
        metric: 'triangles',
        value: renderer.triangles
    });
    set(30, 40, 4.5, true);
    await benchFrames(gl, 120, (i)=>{
        cam.lon = 30 + i * 3;
        cam.lat = 40 - 20 * Math.sin(i / 120 * Math.PI);
        renderer.draw(cam);
    }, {
        prefix: 'flat_'
    });
    emit({
        metric: 'flat_triangles',
        value: renderer.triangles
    });
    set(30, 40, 4.5);
    const pickMs = [];
    for(let i = 0; i < 40; i++){
        const t0 = performance.now();
        renderer.pick(cam, W() * (0.3 + 0.01 * i), H() * (0.35 + 0.008 * i));
        pickMs.push(performance.now() - t0);
    }
    emit({
        metric: 'pick_ms',
        values: pickMs
    });
    set(-150, 0, 4.5);
    const sea = pixel(W() / 2, H() / 2);
    emitCheck({
        check: 'ocean-pixel-colour',
        pass: near(sea, OCEAN, 2),
        detail: {
            sea,
            expected: OCEAN
        }
    });
    const bra = idOf('BRA');
    set(-52, -10, 4.5);
    const land = pixel(W() / 2, H() / 2), braBase = ramp(scaleT(rows[bra][3], popMax));
    emitCheck({
        check: 'land-pixel-colour',
        pass: bra >= 0 && litFrom(land, braBase),
        detail: {
            land,
            ramp: braBase
        }
    });
    set(-170, -10, 4.5);
    const R = limbRadiusPx(cam, H());
    const radii = [];
    for(let k = 0; k < 72; k++){
        const a = k / 72 * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        let r = R + 40;
        while(r > R - 20 && near(pixel(W() / 2 + ca * r, H() / 2 + sa * r), BG, 3))r -= 0.5;
        radii.push(r);
    }
    const inner = radii.map((r, k)=>{
        const a = k / 72 * 2 * Math.PI;
        return pixel(W() / 2 + Math.cos(a) * (r - 3), H() / 2 + Math.sin(a) * (r - 3));
    });
    const rimSea = radii.map((_, k)=>near(inner[k], OCEAN, 6));
    const seaDirs = rimSea.filter(Boolean).length;
    const seaOff = radii.filter((r, k)=>rimSea[k] && Math.abs(r - R) > 1.5).length;
    const dents = radii.filter((r)=>r < R - 1.5).length;
    emitCheck({
        check: 'limb-round',
        pass: seaDirs >= 12 && seaOff === 0 && dents === 0,
        detail: `R ${R.toFixed(1)} px; sea rim ${seaDirs} of ${radii.length} directions, ${seaOff} off the circle by >1.5 px; ${dents} dents; ` + `per direction (r - R)/inner rgb: ` + radii.map((r, k)=>`${k}:${(r - R).toFixed(1)}/${inner[k].join(',')}`).join(' ')
    });
    const chn = idOf('CHN');
    set(13, 0, 4.5);
    const R2 = limbRadiusPx(cam, H());
    const [cx, cy] = project(cam, W(), H(), 103, 35, hOf(chn));
    const out = Math.hypot(cx - W() / 2, cy - H() / 2);
    const china = block(cx, cy, 2), mirror = block(W() - cx, H() - cy, 2);
    const chinaBase = ramp(scaleT(rows[chn][3], popMax));
    const wallSeen = china.some((p)=>!near(p, BG, 3) && !near(p, OCEAN, 3));
    const mirrorSpace = mirror.every((p)=>near(p, BG, 3));
    emitCheck({
        check: 'wall-past-limb',
        pass: chn >= 0 && out > R2 + 3 && wallSeen && mirrorSpace,
        detail: {
            beyondLimbPx: out - R2,
            china: china[12],
            chinaRamp: chinaBase,
            mirror: mirror[12]
        }
    });
    set(30, 40, 4.5);
    const rect = canvas.getBoundingClientRect();
    const hovered = {};
    let hoverOk = true;
    for (const [a3, lon, lat] of [
        [
            'EGY',
            30,
            26
        ],
        [
            'TUR',
            35,
            39
        ],
        [
            'DEU',
            10.5,
            51
        ],
        [
            'SAU',
            45,
            24
        ]
    ]){
        const id = idOf(a3);
        const [x, y] = project(cam, W(), H(), lon, lat, hOf(id));
        canvas.dispatchEvent(new PointerEvent('pointermove', {
            clientX: rect.left + x / dpr,
            clientY: rect.top + y / dpr,
            pointerId: 1
        }));
        const text = map.tooltip.hidden ? '' : map.tooltip.textContent ?? '';
        hovered[a3] = text;
        if (renderer.hover !== id || !text.startsWith(rows[id][1])) hoverOk = false;
    }
    const [sx, sy] = project(cam, W(), H(), 18, 34, 0);
    canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: rect.left + sx / dpr,
        clientY: rect.top + sy / dpr,
        pointerId: 1
    }));
    hovered.sea = map.tooltip.hidden ? '' : map.tooltip.textContent;
    if (!map.tooltip.hidden || renderer.hover !== -1) hoverOk = false;
    emitCheck({
        check: 'hover-known-country',
        pass: hoverOk,
        detail: hovered
    });
    set(30, 40, 4.5);
    const p0 = [
        W() * 0.45,
        H() * 0.45
    ], p1 = [
        W() * 0.55,
        H() * 0.52
    ];
    const g0 = unproject(cam, W(), H(), ...p0);
    const ev = (type, [x, y])=>canvas.dispatchEvent(new PointerEvent(type, {
            clientX: rect.left + x / dpr,
            clientY: rect.top + y / dpr,
            pointerId: 7,
            buttons: 1
        }));
    ev('pointerdown', p0);
    for(let i = 1; i <= 10; i++)ev('pointermove', [
        p0[0] + (p1[0] - p0[0]) * i / 10,
        p0[1] + (p1[1] - p0[1]) * i / 10
    ]);
    ev('pointerup', p1);
    const g1 = unproject(cam, W(), H(), ...p1);
    emitCheck({
        check: 'drag-moves-ground',
        pass: Math.abs(g1[0] - g0[0]) < 0.5 && Math.abs(g1[1] - g0[1]) < 0.5,
        detail: {
            pressed: g0,
            underRelease: g1
        }
    });
    set(0, 0, 4.5);
    const xr = W() / 2 + 1.2 * limbRadiusPx(cam, H());
    const before = pixel(xr, H() / 2);
    map.toggle.click();
    map.setFlat(true, false);
    const after = pixel(xr, H() / 2);
    const label = map.toggle.textContent;
    set(103, 35, 4.5, true);
    const flatChina = pixel(W() / 2, H() / 2);
    emitCheck({
        check: 'toggle-changes-outline',
        pass: near(before, BG, 3) && !near(after, BG, 3) && label === 'Globe' && litFrom(flatChina, chinaBase),
        detail: {
            before,
            after,
            label,
            flatChina,
            chinaRamp: chinaBase
        }
    });
    set(30, 40, 4.5);
    emit({
        done: true
    });
}
