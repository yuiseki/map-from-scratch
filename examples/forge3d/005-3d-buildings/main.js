import { makeView, project } from './camera.js';
import { createRenderer } from './gl.js';
export function parseMesh(buf, buildings) {
    const dv = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'BAG3') throw new Error('buildings.bin: bad magic');
    const nv = dv.getUint32(8, true), ni = dv.getUint32(12, true);
    const lo = [
        0,
        1,
        2
    ].map((k)=>dv.getFloat64(20 + k * 8, true));
    const step = [
        0,
        1,
        2
    ].map((k)=>dv.getFloat32(44 + k * 4, true));
    const vertices = new Uint16Array(buf, 64, nv * 4);
    const indices = new Uint16Array(buf, 64 + nv * 8, ni);
    const half = [
        step[0] * 32767.5,
        step[1] * 32767.5
    ];
    const grounds = buildings.map((b)=>b.ground).filter((g)=>g !== null).sort((a, b)=>a - b);
    return {
        vertices,
        indices,
        lo,
        step,
        origin: [
            -half[0],
            -half[1],
            lo[2]
        ],
        groundZ: grounds[grounds.length >> 1] - 0.05,
        extent: Math.max(half[0], half[1]) + 80
    };
}
export class CityScene {
    canvas;
    gl;
    mesh = null;
    buildings = [];
    camera = {
        az: 150,
        el: 42,
        radius: 900
    };
    target = [
        0,
        0,
        0
    ];
    selected = 0;
    drawMs = 0;
    pickMs = 0;
    dpr = 1;
    view = null;
    onSelect = null;
    renderer = null;
    down = null;
    last = [
        0,
        0
    ];
    constructor(canvas){
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        if (!gl) throw new Error('WebGL2 is not available');
        this.gl = gl;
        this.resize();
        window.addEventListener('resize', ()=>{
            this.resize();
            this.draw();
        });
        this.setupInteractions();
    }
    async load(baseDir = '../../..') {
        const dir = `${baseDir}/data/baked/forge3d-005-3d-buildings`;
        const [bin, json] = await Promise.all([
            fetch(`${dir}/buildings.bin`),
            fetch(`${dir}/buildings.json`)
        ]);
        if (!bin.ok) throw new Error(`buildings.bin: HTTP ${bin.status}`);
        if (!json.ok) throw new Error(`buildings.json: HTTP ${json.status}`);
        this.buildings = await json.json();
        this.mesh = parseMesh(await bin.arrayBuffer(), this.buildings);
        this.target = [
            0,
            0,
            this.mesh.groundZ
        ];
        this.renderer = createRenderer(this.gl, this.mesh);
        this.draw();
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round((this.canvas.clientWidth || window.innerWidth) * this.dpr);
        this.canvas.height = Math.round((this.canvas.clientHeight || window.innerHeight) * this.dpr);
    }
    setCamera(next) {
        this.camera = {
            ...this.camera,
            ...next
        };
        this.camera.az = (this.camera.az % 360 + 360) % 360;
        this.camera.el = Math.max(8, Math.min(89, this.camera.el));
        this.camera.radius = Math.max(80, Math.min(3000, this.camera.radius));
    }
    vertex(i) {
        const m = this.mesh;
        return [
            0,
            1,
            2
        ].map((k)=>m.origin[k] + m.vertices[i * 4 + k] * m.step[k]);
    }
    screenOf(p) {
        if (!this.view) return null;
        const s = project(this.view, p);
        return s ? [
            s[0] / this.dpr,
            s[1] / this.dpr
        ] : null;
    }
    pick(x, y) {
        if (!this.renderer || !this.view) return 0;
        const t0 = performance.now();
        const b = this.renderer.pick(this.view, x * this.dpr, y * this.dpr);
        this.pickMs = performance.now() - t0;
        return b;
    }
    select(b) {
        this.selected = b;
        this.draw();
        this.onSelect?.(b ? this.buildings[b - 1] : null);
    }
    setupInteractions() {
        const c = this.canvas;
        c.addEventListener('pointerdown', (e)=>{
            this.down = [
                e.clientX,
                e.clientY
            ];
            this.last = [
                e.clientX,
                e.clientY
            ];
            try {
                c.setPointerCapture(e.pointerId);
            } catch  {}
        });
        c.addEventListener('pointermove', (e)=>{
            if (!this.down) return;
            this.setCamera({
                az: this.camera.az - (e.clientX - this.last[0]) * 0.3,
                el: this.camera.el + (e.clientY - this.last[1]) * 0.2
            });
            this.last = [
                e.clientX,
                e.clientY
            ];
            this.draw();
        });
        c.addEventListener('pointerup', (e)=>{
            if (this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) <= 3) {
                const r = c.getBoundingClientRect();
                this.select(this.pick(e.clientX - r.left, e.clientY - r.top));
            }
            this.down = null;
            try {
                c.releasePointerCapture(e.pointerId);
            } catch  {}
        });
        c.addEventListener('pointercancel', ()=>{
            this.down = null;
        });
        c.addEventListener('wheel', (e)=>{
            e.preventDefault();
            this.setCamera({
                radius: this.camera.radius * Math.exp(e.deltaY * 0.001)
            });
            this.draw();
        }, {
            passive: false
        });
    }
    draw() {
        if (!this.renderer) return;
        const t0 = performance.now();
        this.view = makeView(this.camera, this.target, this.canvas.width, this.canvas.height);
        this.renderer.draw(this.view, this.selected);
        this.drawMs = performance.now() - t0;
    }
}
const started = performance.now();
const scene = new CityScene(document.getElementById('map'));
const info = document.getElementById('info');
scene.onSelect = (b)=>{
    if (!b) {
        info.textContent = 'クリックした建物の情報をここに出します';
        return;
    }
    const h = b.roof !== null && b.ground !== null ? `${(b.roof - b.ground).toFixed(1)} m` : '不明';
    info.innerHTML = `<b>${b.id}</b><br>建築年 ${b.year ?? '不明'} · 高さ ${h} · 屋根 ${b.roofType ?? '不明'} · 体積 ${b.volume.toLocaleString()} m³`;
};
let firstFrameMs = 0;
try {
    await scene.load();
    firstFrameMs = performance.now() - started;
} catch (err) {
    const pre = document.createElement('pre');
    pre.className = 'error';
    pre.textContent = String(err);
    document.body.appendChild(pre);
    throw err;
}
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(scene, firstFrameMs);
}
