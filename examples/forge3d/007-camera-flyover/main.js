import { parseRelief, viewFrom, project, summitWorld } from './terrain.js';
import { createRenderer } from './gl.js';
import { ORBIT_M, RATE, bake, rigs } from './rigs.js';
export class FlyoverScene {
    canvas;
    gl;
    relief = null;
    animations = [];
    current = 0;
    frame = 0;
    playing = false;
    drawMs = 0;
    bakeMs = 0;
    dpr = 1;
    view = null;
    onFrame = null;
    renderer = null;
    startedAt = 0;
    startFrame = 0;
    constructor(canvas){
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });
        if (!gl) throw new Error('WebGL2 is not available');
        this.gl = gl;
        this.resize();
        window.addEventListener('resize', ()=>{
            this.resize();
            this.draw();
        });
    }
    async load(baseDir = '../../..') {
        const res = await fetch(`${baseDir}/data/baked/forge3d-001-mount-rainier/rainier.bin`);
        if (!res.ok) throw new Error(`rainier.bin: HTTP ${res.status}`);
        this.relief = parseRelief(await res.arrayBuffer());
        this.renderer = createRenderer(this.gl, this.relief);
        const t0 = performance.now();
        this.animations = rigs(this.relief).map((rig)=>bake(this.relief, rig));
        this.bakeMs = performance.now() - t0;
        this.draw();
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round((this.canvas.clientWidth || window.innerWidth) * this.dpr);
        this.canvas.height = Math.round((this.canvas.clientHeight || window.innerHeight) * this.dpr);
    }
    get animation() {
        return this.animations[this.current];
    }
    drawFrom(eye, target) {
        if (!this.renderer) return;
        const t0 = performance.now();
        this.view = viewFrom(eye, target, this.canvas.width, this.canvas.height);
        this.renderer.draw(this.view);
        this.drawMs = performance.now() - t0;
    }
    draw() {
        if (!this.animations.length) return;
        const s = this.animation.samples, i = this.frame * 6;
        this.drawFrom([
            s[i],
            s[i + 1],
            s[i + 2]
        ], [
            s[i + 3],
            s[i + 4],
            s[i + 5]
        ]);
        this.onFrame?.();
    }
    seek(frame) {
        this.frame = Math.max(0, Math.min(this.animation.frames - 1, Math.round(frame)));
        this.startFrame = this.frame;
        this.startedAt = performance.now();
        this.draw();
    }
    choose(index) {
        this.current = index;
        this.seek(0);
    }
    play(on) {
        this.playing = on;
        this.startedAt = performance.now();
        this.startFrame = this.frame >= this.animation.frames - 1 ? 0 : this.frame;
        if (on) requestAnimationFrame(this.tick);
        this.onFrame?.();
    }
    tick = (now)=>{
        if (!this.playing) return;
        const f = this.startFrame + Math.floor((now - this.startedAt) / 1000 * RATE);
        this.frame = Math.min(this.animation.frames - 1, Math.max(0, f));
        this.draw();
        if (this.frame >= this.animation.frames - 1) {
            this.playing = false;
            this.onFrame?.();
            return;
        }
        requestAnimationFrame(this.tick);
    };
    orbitView(phiDeg) {
        const summit = summitWorld(this.relief);
        const az = phiDeg * Math.PI / 180, el = 40 * Math.PI / 180;
        return {
            eye: [
                summit[0] + Math.sin(az) * Math.cos(el) * ORBIT_M,
                summit[1] + Math.cos(az) * Math.cos(el) * ORBIT_M,
                summit[2] + Math.sin(el) * ORBIT_M
            ],
            target: summit
        };
    }
    screenOf(p) {
        if (!this.view) return null;
        const s = project(this.view, p);
        return s ? [
            s[0] / this.dpr,
            s[1] / this.dpr
        ] : null;
    }
}
const started = performance.now();
const scene = new FlyoverScene(document.getElementById('map'));
const slider = document.getElementById('time');
const playBtn = document.getElementById('play');
const clock = document.getElementById('clock');
const presetBtns = [
    ...document.querySelectorAll('[data-rig]')
];
scene.onFrame = ()=>{
    const a = scene.animation;
    slider.max = String(a.frames - 1);
    slider.value = String(scene.frame);
    playBtn.textContent = scene.playing ? '一時停止' : '再生';
    clock.textContent = `${(scene.frame / RATE).toFixed(2)} / ${a.rig.duration.toFixed(1)} s`;
    presetBtns.forEach((b, i)=>b.setAttribute('aria-pressed', String(i === scene.current)));
};
slider.addEventListener('input', ()=>{
    scene.playing = false;
    scene.seek(Number(slider.value));
});
playBtn.addEventListener('click', ()=>scene.play(!scene.playing));
presetBtns.forEach((b, i)=>b.addEventListener('click', ()=>{
        scene.playing = false;
        scene.choose(i);
    }));
let firstFrameMs = 0;
try {
    await scene.load();
    for (const thumb of document.querySelectorAll('canvas[data-phi]')){
        const { eye, target } = scene.orbitView(Number(thumb.dataset.phi));
        scene.drawFrom(eye, target);
        thumb.width = thumb.clientWidth * scene.dpr;
        thumb.height = thumb.clientHeight * scene.dpr;
        const c = scene.canvas, a = thumb.width / thumb.height;
        const sw = Math.min(c.width, c.height * a), sh = sw / a;
        thumb.getContext('2d').drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, 0, 0, thumb.width, thumb.height);
    }
    scene.choose(0);
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
} else {
    scene.play(true);
}
