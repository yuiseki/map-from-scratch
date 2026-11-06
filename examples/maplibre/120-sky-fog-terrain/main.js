import { decodeHeights, sampleHeight } from './heights.js';
import { clampCamera, drag, zoom } from './camera.js';
import { DEFAULT_SKY, skyUniforms } from './sky.js';
import { createRenderer } from './render.js';
const pageStart = window.__mfsPageStart ?? 0;
const DATA = '../../../data/baked/maplibre-120-sky-fog-terrain/';
async function load(name) {
    const res = await fetch(DATA + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    let u8 = new Uint8Array(await res.arrayBuffer());
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
        u8 = new Uint8Array(await new Response(new Blob([
            u8
        ]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    return decodeHeights(u8);
}
const canvas = document.getElementById('map');
const renderer = createRenderer(canvas);
const [near, far] = await Promise.all([
    load('near.mfsh.gz'),
    load('far.mfsh.gz')
]);
const half = (near.w - 1) / 2;
const cx = near.x0 + half + 0.5, cy = near.y0 + half + 0.5;
const originOf = (g)=>{
    const k = 2 ** (near.z - g.z);
    return [
        ((g.x0 + 0.5) * k - cx) * near.step,
        -((g.y0 + 0.5) * k - cy) * near.step
    ];
};
const nearO = originOf(near), farO = originOf(far);
const e = half * near.step - far.step;
renderer.addLevel(near, nearO);
renderer.addLevel(far, farO, [
    -e,
    -e,
    e,
    e
]);
const ground = (x, y)=>sampleHeight(near, nearO[0], nearO[1], x, y) ?? sampleHeight(far, farO[0], farO[1], x, y);
const local = (lon, lat)=>{
    const n = 512 * 2 ** near.z, s = Math.sin(lat * Math.PI / 180);
    return [
        ((lon + 180) / 360 * n - cx) * near.step,
        -((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - cy) * near.step
    ];
};
const [yx, yy] = local(137.6478, 36.342);
let cam = clampCamera({
    tx: yx,
    ty: yy,
    tz: ground(yx, yy) ?? 0,
    bearing: 345,
    pitch: 78,
    distance: 11000
}, ground);
const ui = {
    enabled: document.getElementById('sky-enabled'),
    skyColor: document.getElementById('sky-color-picker'),
    horizonColor: document.getElementById('horizon-color-picker'),
    fogColor: document.getElementById('fog-color-picker'),
    skyHorizonBlend: document.getElementById('sky-horizon-blend-slider'),
    horizonFogBlend: document.getElementById('horizon-fog-blend-slider'),
    fogGroundBlend: document.getElementById('fog-ground-blend-slider')
};
const readSky = ()=>({
        enabled: ui.enabled.checked,
        skyColor: ui.skyColor.value,
        horizonColor: ui.horizonColor.value,
        fogColor: ui.fogColor.value,
        skyHorizonBlend: +ui.skyHorizonBlend.value,
        horizonFogBlend: +ui.horizonFogBlend.value,
        fogGroundBlend: +ui.fogGroundBlend.value
    });
ui.enabled.checked = DEFAULT_SKY.enabled;
for (const k of [
    'skyColor',
    'horizonColor',
    'fogColor'
])ui[k].value = DEFAULT_SKY[k];
for (const k of [
    'skyHorizonBlend',
    'horizonFogBlend',
    'fogGroundBlend'
])ui[k].value = String(DEFAULT_SKY[k]);
function resize() {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
}
function draw() {
    const sky = readSky();
    renderer.draw(cam, skyUniforms(sky, cam.pitch, canvas.height / devicePixelRatio, devicePixelRatio, cam.distance), sky.enabled);
}
let pending = 0;
const request = ()=>{
    if (!pending) pending = requestAnimationFrame(()=>{
        pending = 0;
        draw();
    });
};
resize();
draw();
const firstFrame = performance.now() - pageStart;
new ResizeObserver(()=>{
    resize();
    draw();
}).observe(canvas);
for (const el of Object.values(ui))el.addEventListener('input', request);
let last = null;
canvas.addEventListener('pointerdown', (ev)=>{
    last = {
        x: ev.clientX,
        y: ev.clientY
    };
    canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev)=>{
    if (!last) return;
    cam = clampCamera(drag(cam, ev.clientX - last.x, ev.clientY - last.y), ground);
    last = {
        x: ev.clientX,
        y: ev.clientY
    };
    request();
});
const up = ()=>{
    last = null;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (ev)=>{
    ev.preventDefault();
    cam = clampCamera(zoom(cam, ev.deltaY), ground);
    request();
}, {
    passive: false
});
if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.js');
    await run({
        gl: renderer.gl,
        ui,
        firstFrame,
        triangles: renderer.triangles(),
        ground,
        getCam: ()=>cam,
        setCam: (c)=>{
            cam = clampCamera(c, ground);
        },
        draw
    });
}
