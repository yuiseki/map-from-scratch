import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.js';
import { project, eye, basis } from './camera.js';
import { EXAG, LIGHT, openingCam, skyAt, sunColor, toScreen, luminance } from './look.js';
const RAD = Math.PI / 180;
const SUMMIT = [
    138.7274,
    35.3606
];
const OSHINO = [
    138.8350,
    35.4600
];
const YAMANAKA = [
    138.8768,
    35.4187
];
const raf = ()=>new Promise((r)=>requestAnimationFrame(r));
export async function run(app, firstFrameMs) {
    const { gl, canvas } = app;
    canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webgl context lost'
        }));
    emit({
        info: {
            gpu: glRenderer(gl),
            grid: `${app.grid.w}x${app.grid.h}`,
            cell_m: app.grid.cell,
            h_ref_m: app.hRef
        }
    });
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const W = canvas.clientWidth, H = canvas.clientHeight, dpr = canvas.width / W;
    const lum = (x, y)=>{
        app.draw();
        const px = new Uint8Array(4 * 25);
        gl.readPixels(Math.round(x * dpr) - 2, canvas.height - Math.round(y * dpr) - 3, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let s = 0;
        for(let k = 0; k < 25; k++)s += 0.2126 * px[4 * k] + 0.7152 * px[4 * k + 1] + 0.0722 * px[4 * k + 2];
        return s / 25;
    };
    const screen = (lonlat)=>project(app.cam, app.toLocal(...lonlat), W, H);
    const setCam = (lonlat, c)=>{
        const p = app.toLocal(...lonlat);
        Object.assign(app.cam, {
            tx: p[0],
            ty: p[1]
        }, c);
        app.draw();
    };
    const pointer = (type, x, y, buttons = 0)=>{
        const r = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new PointerEvent(type, {
            clientX: r.left + x,
            clientY: r.top + y,
            buttons,
            button: 0,
            pointerId: 1,
            bubbles: true
        }));
    };
    const f1 = (v)=>v.toFixed(1);
    app.setSun(false);
    app.setExag(1);
    app.setShadows(true);
    setCam(SUMMIT, {
        bearing: 0,
        tilt: 55 * RAD,
        dist: 30000
    });
    const east = screen([
        SUMMIT[0] + 0.03,
        SUMMIT[1]
    ]), west = screen([
        SUMMIT[0] - 0.03,
        SUMMIT[1]
    ]);
    pointer('pointermove', W / 2 + 0.3 * Math.min(W, H), H / 2);
    const eLit = lum(east.x, east.y), wDark = lum(west.x, west.y), azE = app.light.az / RAD;
    emit({
        check: 'lit-slope-brighter',
        pass: Math.abs(azE - 90) < 1 && eLit > 1.3 * wDark,
        detail: `pointer right: light az ${f1(azE)} alt ${f1(app.light.alt / RAD)}; east flank ${f1(eLit)}, west flank ${f1(wDark)}`
    });
    pointer('pointermove', W / 2 - 0.3 * Math.min(W, H), H / 2);
    const eDark = lum(east.x, east.y), wLit = lum(west.x, west.y), azW = app.light.az / RAD;
    emit({
        check: 'order-flips-with-light',
        pass: Math.abs(azW + 90) < 1 && wLit > 1.3 * eDark,
        detail: `pointer left: light az ${f1(azW)}; east flank ${f1(eDark)}, west flank ${f1(wLit)}`
    });
    setCam(OSHINO, {
        bearing: 0,
        tilt: 70 * RAD,
        dist: 25000
    });
    const o = app.toLocal(...OSHINO), s = app.toLocal(...SUMMIT);
    const azSun = Math.atan2(s[0] - o[0], s[1] - o[1]);
    const at = screen(OSHINO);
    const ratio = (alt)=>{
        app.setLight(azSun, alt * RAD, [
            1,
            1,
            1
        ]);
        app.setShadows(true);
        const on = lum(at.x, at.y);
        app.setShadows(false);
        const off = lum(at.x, at.y);
        app.setShadows(true);
        return {
            on,
            off,
            r: on / off
        };
    };
    const low = ratio(7), high = ratio(45);
    emit({
        check: 'valley-cast-shadow',
        pass: low.r < 0.75 && high.r > 0.97,
        detail: `sun az ${f1(azSun / RAD)}: alt 7° shadow on/off ${f1(low.on)}/${f1(low.off)} (${low.r.toFixed(3)}), alt 45° ${f1(high.on)}/${f1(high.off)} (${high.r.toFixed(3)})`
    });
    setCam(YAMANAKA, {
        bearing: 30 * RAD,
        tilt: 35 * RAD,
        dist: 20000
    });
    const lp = app.toLocal(...YAMANAKA), e = eye(app.cam), lk = screen(YAMANAKA);
    const v = [
        e[0] - lp[0],
        e[1] - lp[1],
        e[2] - lp[2]
    ], vl = Math.hypot(...v);
    const azM = Math.atan2(-v[0], -v[1]), altM = Math.asin(v[2] / vl);
    app.setLight(azM, altM);
    const glint = lum(lk.x, lk.y);
    app.setLight(azM + Math.PI / 2, altM);
    const plain = lum(lk.x, lk.y);
    emit({
        check: 'water-specular',
        pass: glint > 1.5 * plain,
        detail: `light mirrored (az ${f1(azM / RAD)} alt ${f1(altM / RAD)}): lake ${f1(glint)}; 90° round: ${f1(plain)}`
    });
    setCam(SUMMIT, {
        bearing: 0,
        tilt: 25 * RAD,
        dist: 40000
    });
    app.setLight(315 * RAD, 35 * RAD);
    const top = screen(SUMMIT), foot = project(app.cam, [
        s[0],
        s[1],
        0
    ], W, H);
    const skyLum = (x, y)=>{
        const { f, r, u } = basis(app.cam), th = Math.tan(app.cam.fovy / 2), nx = 2 * x / W - 1, ny = 1 - 2 * y / H;
        const d = [
            0,
            1,
            2
        ].map((k)=>f[k] + r[k] * nx * th * (W / H) + u[k] * ny * th);
        return luminance(toScreen(skyAt(d[2] / Math.hypot(...d), app.light.color)));
    };
    const sky = lum(W / 2, 4), skyWant = skyLum(W / 2, 4), peak = lum(top.x, top.y + 4);
    emit({
        check: 'terrain-3d',
        pass: foot.y - top.y > 40 && Math.abs(sky - skyWant) < 6 && Math.abs(peak - sky) > 15,
        detail: `summit ${f1(top.y)} px vs foot ${f1(foot.y)} px; sky lum ${f1(sky)} (want ${f1(skyWant)}), summit lum ${f1(peak)}`
    });
    Object.assign(app.cam, openingCam(app.grid, app.hRef, EXAG));
    app.setExag(EXAG);
    app.setLight(LIGHT.az, LIGHT.alt);
    const os = screen(SUMMIT), of = project(app.cam, [
        s[0],
        s[1],
        (1000 - app.hRef) * EXAG
    ], W, H);
    const above = lum(os.x, os.y - 12), aboveWant = skyLum(os.x, os.y - 12), summitL = lum(os.x, os.y + 6);
    const warm = sunColor(LIGHT.alt);
    emit({
        check: 'opening-view-sky',
        pass: of.y - os.y > 0.25 * H && os.y > 0.1 * H && Math.abs(above - aboveWant) < 8 && Math.abs(summitL - above) > 10 && warm[0] / warm[2] > 1.5,
        detail: `summit at ${f1(os.x)},${f1(os.y)} px, ${f1(of.y - os.y)} px above its foot; sky above it lum ${f1(above)} (want ${f1(aboveWant)}), summit lum ${f1(summitL)}; light ${warm.map((v)=>v.toFixed(2))}`
    });
    app.setExag(1);
    setCam(SUMMIT, {
        bearing: 0,
        tilt: 25 * RAD,
        dist: 40000
    });
    app.setLight(315 * RAD, 35 * RAD);
    const south = app.toLocal(SUMMIT[0], SUMMIT[1] - 0.05);
    const before = project(app.cam, south, W, H), b0 = app.cam.bearing;
    pointer('pointerdown', W / 2, H / 2, 1);
    pointer('pointermove', W / 2 + 60, H / 2, 1);
    pointer('pointerup', W / 2 + 60, H / 2);
    const after = project(app.cam, south, W, H);
    const q = [
        app.cam.tx + 3000,
        app.cam.ty - 2000,
        app.cam.tz
    ], qs = project(app.cam, q, W, H), d0 = app.cam.dist;
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -300,
        clientX: r.left + qs.x,
        clientY: r.top + qs.y,
        bubbles: true,
        cancelable: true
    }));
    const qa = project(app.cam, q, W, H);
    emit({
        check: 'drag-and-wheel',
        pass: app.cam.bearing > b0 && after.x > before.x + 5 && app.cam.dist < d0 * 0.8 && Math.hypot(qa.x - qs.x, qa.y - qs.y) < 1,
        detail: `bearing ${f1(b0 / RAD)} -> ${f1(app.cam.bearing / RAD)}, south point x ${f1(before.x)} -> ${f1(after.x)}; dist ${Math.round(d0)} -> ${Math.round(app.cam.dist)}, point under the pointer moved ${Math.hypot(qa.x - qs.x, qa.y - qs.y).toFixed(2)} px`
    });
    setCam(SUMMIT, {
        bearing: 0,
        tilt: 55 * RAD,
        dist: 30000
    });
    document.getElementById('sun').click();
    for(let k = 0; k < 3; k++)await raf();
    const a0 = app.light.az, p0 = app.shadowPasses, l0 = lum(east.x, east.y), t0 = performance.now();
    let frames = 0;
    while(performance.now() - t0 < 1000){
        await raf();
        frames++;
    }
    const secs = (performance.now() - t0) / 1000;
    const a1 = app.light.az, p1 = app.shadowPasses, l1 = lum(east.x, east.y);
    document.getElementById('sun').click();
    emit({
        check: 'sun-toggle-animates',
        pass: app.sun === false && (a1 - a0) / RAD > 3 && p1 - p0 >= Math.min(30, frames) && Math.abs(l1 - l0) > 2,
        detail: `az ${f1(a0 / RAD)} -> ${f1(a1 / RAD)} over ${secs.toFixed(2)} s (${frames} frames), ${p1 - p0} shadow passes, east flank ${f1(l0)} -> ${f1(l1)}`
    });
    Object.assign(app.cam, openingCam(app.grid, app.hRef, EXAG));
    app.setExag(EXAG);
    const N = 240;
    await benchFrames(gl, N, (i)=>{
        const t = i / N;
        app.setLight(2 * Math.PI * t, (8 + 40 * (0.5 + 0.5 * Math.sin(4 * Math.PI * t))) * RAD);
        app.draw();
    }, {
        prefix: 'light_'
    });
    app.setLight(LIGHT.az, LIGHT.alt);
    app.draw();
    await benchFrames(gl, N, (i)=>{
        const t = i / N;
        Object.assign(app.cam, {
            bearing: (200 + 360 * t) * RAD,
            dist: 52000 * (0.6 + 0.4 * Math.cos(2 * Math.PI * t))
        });
        app.draw();
    }, {
        prefix: 'orbit_'
    });
    emit({
        done: true
    });
}
