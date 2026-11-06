import { createRenderer } from './render.js';
import { viewOf, orbitDrag, panDrag, wheelZoom, HOME } from './camera.js';
import { select } from './lod.js';
import { DEFAULTS, edlActive, edlUniforms, pointUniforms } from './shading.js';
const DATA = '../../../data/baked/cesium-034-3d-tiles-point-cloud-shading/';
const MAX_IN_FLIGHT = 4;
const params = new URLSearchParams(location.search);
const bench = params.has('bench');
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const renderer = createRenderer(canvas);
const orbit = {
    ...HOME
};
const shading = {
    ...DEFAULTS
};
const lod = {
    maximumScreenSpaceError: 16
};
let tileset = null;
const meshes = new Map();
const inFlight = new Set();
const failed = new Set();
const kept = new Map();
const stats = {
    bytes: 0,
    requests: 0,
    points: 0,
    nodes: 0,
    wanted: 0
};
let error = '';
let pending = false;
function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(()=>{
        pending = false;
        render();
    });
}
async function fetchCounted(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    stats.bytes += bytes.byteLength;
    stats.requests++;
    return bytes;
}
async function load(i) {
    const node = tileset.nodes[i];
    inFlight.add(i);
    try {
        const bytes = await fetchCounted(DATA + node.file);
        meshes.set(i, renderer.upload(node, bytes));
        if (bench) kept.set(i, bytes);
    } catch (e) {
        failed.add(i);
        error = String(e);
    } finally{
        inFlight.delete(i);
        schedule();
    }
}
function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    return dpr;
}
function render() {
    if (!tileset) return;
    const dpr = resize();
    const view = viewOf(orbit, canvas.width, canvas.height);
    const sel = select(tileset, view, canvas.height / dpr, lod.maximumScreenSpaceError, (i)=>meshes.has(i) || failed.has(i));
    for (const i of sel.want){
        if (inFlight.size >= MAX_IN_FLIGHT) break;
        if (!inFlight.has(i) && !failed.has(i)) void load(i);
    }
    const items = sel.draw.filter((i)=>meshes.has(i)).map((i)=>{
        const mesh = meshes.get(i);
        return {
            mesh,
            point: pointUniforms(mesh.node, shading, lod.maximumScreenSpaceError, canvas.height, dpr)
        };
    });
    renderer.draw({
        view,
        items,
        edl: {
            on: edlActive(shading),
            ...edlUniforms(shading, dpr)
        }
    });
    stats.points = items.reduce((s, it)=>s + it.mesh.node.count, 0);
    stats.nodes = items.length;
    stats.wanted = sel.want.length;
    status.textContent = `${stats.points.toLocaleString()} 点 / ${stats.nodes} ノード描画 · 読込 ${(stats.bytes / 1048576).toFixed(1)} MB (${stats.requests} 件)${sel.want.length ? ` · 待ち ${sel.want.length}` : ''}${error ? ` · ${error}` : ''}`;
}
function bindRange(id, get, set) {
    const range = document.getElementById(id), text = document.getElementById(`${id}-text`);
    range.value = text.value = String(get());
    range.addEventListener('input', ()=>{
        set(Number(range.value));
        text.value = range.value;
        schedule();
    });
    text.addEventListener('change', ()=>{
        const v = Number(text.value);
        if (Number.isFinite(v)) {
            set(v);
            range.value = String(v);
            schedule();
        }
    });
}
function bindToggle(id, get, set) {
    const box = document.getElementById(id);
    box.checked = get();
    box.addEventListener('input', ()=>{
        set(box.checked);
        schedule();
    });
}
bindRange('mse', ()=>lod.maximumScreenSpaceError, (v)=>{
    lod.maximumScreenSpaceError = v;
});
bindRange('ges', ()=>shading.geometricErrorScale, (v)=>{
    shading.geometricErrorScale = v;
});
bindRange('maxatt', ()=>shading.maximumAttenuation, (v)=>{
    shading.maximumAttenuation = v;
});
bindRange('baseres', ()=>shading.baseResolution, (v)=>{
    shading.baseResolution = v;
});
bindRange('edls', ()=>shading.eyeDomeLightingStrength, (v)=>{
    shading.eyeDomeLightingStrength = v;
});
bindRange('edlr', ()=>shading.eyeDomeLightingRadius, (v)=>{
    shading.eyeDomeLightingRadius = v;
});
bindToggle('att', ()=>shading.attenuation, (v)=>{
    shading.attenuation = v;
});
bindToggle('edl', ()=>shading.eyeDomeLighting, (v)=>{
    shading.eyeDomeLighting = v;
});
let drag = null;
canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
canvas.addEventListener('pointerdown', (e)=>{
    try {
        canvas.setPointerCapture(e.pointerId);
    } catch  {}
    drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        pan: e.button === 2 || e.shiftKey
    };
});
canvas.addEventListener('pointermove', (e)=>{
    if (drag?.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) panDrag(orbit, dx, dy, canvas.clientHeight);
    else orbitDrag(orbit, dx, dy);
    schedule();
});
const end = ()=>{
    drag = null;
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    wheelZoom(orbit, e.deltaY);
    schedule();
}, {
    passive: false
});
new ResizeObserver(schedule).observe(canvas);
fetchCounted(DATA + 'tileset.json').then((bytes)=>{
    tileset = JSON.parse(new TextDecoder().decode(bytes));
    document.getElementById('credit').textContent = tileset.attribution;
    schedule();
}).catch((e)=>{
    error = String(e);
    status.textContent = error;
});
if (bench) {
    const app = {
        gl: renderer.gl,
        canvas,
        orbit,
        shading,
        lod,
        tileset: ()=>tileset,
        render,
        stats,
        kept,
        idle: ()=>!!tileset && inFlight.size === 0 && stats.wanted === 0 && !pending,
        error: ()=>error,
        drawn: ()=>{
            const view = viewOf(orbit, canvas.width, canvas.height);
            return select(tileset, view, canvas.height / Math.min(2, devicePixelRatio || 1), lod.maximumScreenSpaceError, (i)=>meshes.has(i)).draw;
        }
    };
    void import('./bench.js').then(({ run })=>run(app));
}
