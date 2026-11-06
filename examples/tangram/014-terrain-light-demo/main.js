import { decodeGrid, gradients, meshSize, gridIndices, lonLatToTexel, texelToLocal } from './grid.js';
import { basis, eye, viewProj, orbit, zoomAt, lightFromPointer } from './camera.js';
import { lightDir, sunAt, sunPhase, marchGrowth, SHADOW_STEPS } from './light.js';
import { fullscreenVertex, shadowFragment, skyFragment, terrainVertex, terrainFragment } from './shaders.js';
import { VIEW, EXAG, LIGHT, HAZE_BEYOND, sunColor, openingCam } from './look.js';
const FILE = '../../../data/baked/tangram-014-terrain-light-demo/fuji.mftl';
const MESH_STEP = 2;
const RAD = Math.PI / 180;
const canvas = document.getElementById('map');
const gl = canvas.getContext('webgl2', {
    antialias: true
});
const $ = (id)=>document.getElementById(id);
const res = await fetch(FILE);
if (!res.ok || !res.body) throw new Error(`${FILE}: ${res.status}`);
const grid = decodeGrid(new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()));
const { w, h, cell } = grid;
let hRef = Infinity;
for (const v of grid.heights)hRef = Math.min(hRef, v);
function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [
        [
            gl.VERTEX_SHADER,
            vs
        ],
        [
            gl.FRAGMENT_SHADER,
            fs
        ]
    ]){
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
}
const uniforms = (p)=>new Proxy({}, {
        get: (o, k)=>o[k] ??= gl.getUniformLocation(p, k)
    });
function texture(unit, internal, format, type, filter, data) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
}
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
texture(0, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, grid.heights);
texture(1, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, gradients(grid.heights, grid.water, w, h, cell));
const shadowTex = texture(2, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, null);
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const shadowProg = program(fullscreenVertex(), shadowFragment()), su = uniforms(shadowProg);
const skyProg = program(fullscreenVertex(), skyFragment()), ku = uniforms(skyProg);
const terrainProg = program(terrainVertex(), terrainFragment()), tu = uniforms(terrainProg);
const { nx, ny } = meshSize(w, h, MESH_STEP);
const indices = gridIndices(nx, ny);
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
gl.bindVertexArray(null);
const growth = marchGrowth(SHADOW_STEPS, Math.hypot(w, h));
let shadowDirty = true, pending = 0;
const app = {
    gl,
    canvas,
    grid,
    hRef,
    cam: openingCam(grid, hRef),
    light: {
        ...LIGHT,
        color: sunColor(LIGHT.alt)
    },
    exag: EXAG,
    shadows: true,
    sun: false,
    shadowPasses: 0,
    draw,
    request () {
        if (!pending) pending = requestAnimationFrame(()=>{
            pending = 0;
            draw();
        });
    },
    setLight (az, alt, color = sunColor(alt)) {
        app.light = {
            az,
            alt,
            color
        };
        shadowDirty = true;
        app.request();
    },
    setSun (on) {
        app.sun = on;
        $('sun').setAttribute('aria-pressed', String(on));
        if (on) {
            sunStart = performance.now();
            requestAnimationFrame(tick);
        }
    },
    setExag (e) {
        app.exag = e;
        shadowDirty = true;
        app.request();
    },
    setShadows (on) {
        app.shadows = on;
        app.request();
    },
    toLocal (lon, lat) {
        const t = lonLatToTexel(lon, lat, grid), p = texelToLocal(t.i, t.j, grid);
        const i = Math.min(w - 1, Math.max(0, Math.floor(t.i))), j = Math.min(h - 1, Math.max(0, Math.floor(t.j)));
        return [
            p.x,
            p.y,
            (grid.heights[j * w + i] - hRef) * app.exag
        ];
    }
};
function draw() {
    const { light, cam, exag } = app;
    cam.tz = (VIEW.targetH - hRef) * exag;
    gl.disable(gl.DEPTH_TEST);
    if (shadowDirty) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, w, h);
        gl.useProgram(shadowProg);
        gl.uniform1i(su.u_h, 0);
        gl.uniform2f(su.u_dir, Math.sin(light.az), -Math.cos(light.az));
        gl.uniform1f(su.u_tanAlt, Math.tan(light.alt));
        gl.uniform1f(su.u_growth, growth);
        gl.uniform1f(su.u_cell, cell);
        gl.uniform1f(su.u_exag, exag);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        shadowDirty = false;
        app.shadowPasses++;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const L = lightDir(light.az, light.alt), { f, r, u } = basis(cam);
    gl.useProgram(skyProg);
    gl.uniform3fv(ku.u_f, f);
    gl.uniform3fv(ku.u_r, r);
    gl.uniform3fv(ku.u_u, u);
    gl.uniform3fv(ku.u_L, L);
    gl.uniform3fv(ku.u_col, light.color);
    gl.uniform2f(ku.u_res, canvas.width, canvas.height);
    gl.uniform1f(ku.u_th, Math.tan(cam.fovy / 2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(terrainProg);
    const e = eye(cam);
    gl.uniform1i(tu.u_h, 0);
    gl.uniform1i(tu.u_g, 1);
    gl.uniform1i(tu.u_s, 2);
    gl.uniform1i(tu.u_nx, nx);
    gl.uniform1i(tu.u_step, MESH_STEP);
    gl.uniform1f(tu.u_cell, cell);
    gl.uniform1f(tu.u_exag, exag);
    gl.uniform1f(tu.u_href, hRef);
    gl.uniform3f(tu.u_eye, e[0], e[1], e[2]);
    gl.uniformMatrix4fv(tu.u_vp, false, viewProj(cam, canvas.width / canvas.height));
    gl.uniform3fv(tu.u_L, L);
    gl.uniform3fv(tu.u_col, light.color);
    gl.uniform1f(tu.u_shadowOn, app.shadows ? 1 : 0);
    gl.uniform1f(tu.u_hazeStart, cam.dist + HAZE_BEYOND);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    $('readout').textContent = `光 方位 ${Math.round((light.az / RAD % 360 + 360) % 360)}° 高度 ${Math.round(light.alt / RAD)}°`;
}
let sunStart = 0, sunStartPhase = 0.1;
function tick(now) {
    if (!app.sun) return;
    const phase = sunPhase(now, sunStart, sunStartPhase);
    const s = sunAt(phase);
    app.light = {
        az: s.az,
        alt: s.alt,
        color: s.color
    };
    shadowDirty = true;
    sunStart = now;
    sunStartPhase = phase;
    draw();
    requestAnimationFrame(tick);
}
let drag = null;
canvas.addEventListener('pointerdown', (ev)=>{
    if (ev.button !== 0) return;
    drag = {
        x: ev.clientX,
        y: ev.clientY
    };
    try {
        canvas.setPointerCapture(ev.pointerId);
    } catch  {}
});
canvas.addEventListener('pointermove', (ev)=>{
    if (drag) {
        orbit(app.cam, ev.clientX - drag.x, ev.clientY - drag.y);
        drag = {
            x: ev.clientX,
            y: ev.clientY
        };
        app.request();
    } else if (!app.sun) {
        const r = canvas.getBoundingClientRect();
        const l = lightFromPointer(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height, app.cam.bearing);
        app.setLight(l.az, l.alt);
    }
});
const endDrag = ()=>{
    drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (ev)=>{
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(app.cam, Math.exp(ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top, r.width, r.height);
    app.request();
}, {
    passive: false
});
$('sun').addEventListener('click', ()=>app.setSun(!app.sun));
$('shadows').addEventListener('change', (ev)=>app.setShadows(ev.target.checked));
$('exag').value = String(EXAG);
$('exagv').textContent = `${EXAG.toFixed(1)}x`;
$('exag').addEventListener('input', (ev)=>{
    const v = Number(ev.target.value);
    $('exagv').textContent = `${v.toFixed(1)}x`;
    app.setExag(v);
});
new ResizeObserver(([entry])=>{
    const box = entry.devicePixelContentBoxSize?.[0];
    canvas.width = box ? box.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio);
    canvas.height = box ? box.blockSize : Math.round(entry.contentRect.height * devicePixelRatio);
    app.request();
}).observe(canvas, {
    box: 'device-pixel-content-box'
});
const rect = canvas.getBoundingClientRect();
canvas.width = Math.round(rect.width * devicePixelRatio);
canvas.height = Math.round(rect.height * devicePixelRatio);
draw();
window.__app = app;
if (location.search.includes('bench')) {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const firstFrameMs = performance.now();
    import('./bench.js').then((b)=>b.run(app, firstFrameMs));
}
