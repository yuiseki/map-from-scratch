import { decode, BANDS } from './format.js';
import { createRenderer } from './render.js';
import { makeView, panBy, zoomAt } from './camera.js';
import { lightOf, levelOf } from './dance.js';
import { analyseRhythm, levelsAt, configure } from './audio.js';
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const gl = canvas.getContext('webgl2', {
    antialias: true
});
export const START = {
    cx: 0,
    cy: -150,
    bearing: -20,
    pitch: 66,
    distance: 2400
};
let cam = {
    ...START
};
const levels = new Float32Array(BANDS), light = new Float32Array(4);
let renderer = null;
let rhythm = null;
let mic = null;
let player = null;
let running = true, dragging = false, last = 0;
function resize() {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
}
new ResizeObserver(resize).observe(canvas);
resize();
const view = (c1 = cam)=>makeView(c1, canvas.width, canvas.height);
const fog = (c1 = cam)=>[
        c1.distance + 1500,
        c1.distance + 4500
    ];
function draw(c1, lv, nowMs) {
    renderer.draw(view(c1), lv, lightOf(nowMs, lv, light), fog(c1));
}
function readLevels(now) {
    if (mic) {
        mic.analyser.getByteFrequencyData(mic.bins);
        for(let i = 0; i < BANDS; i++)levels[i] = levelOf(mic.bins[i]);
    } else if (rhythm) levelsAt(rhythm.table, now / 1000, levels);
}
function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!dragging && last) cam.bearing = (cam.bearing + (now - last) * 0.002) % 360;
    last = now;
    readLevels(now);
    draw(cam, levels, now);
}
let px = 0, py = 0, turn = false;
const at = (e)=>{
    const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
    return [
        (e.clientX - r.left) * k,
        (e.clientY - r.top) * k
    ];
};
canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
canvas.addEventListener('pointerdown', (e)=>{
    try {
        canvas.setPointerCapture(e.pointerId);
    } catch  {}
    [px, py] = at(e);
    dragging = true;
    turn = e.button === 2 || e.shiftKey || e.ctrlKey;
});
canvas.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    const [x, y] = at(e);
    cam = turn ? {
        ...cam,
        bearing: cam.bearing + (x - px) * 0.3,
        pitch: Math.min(85, Math.max(0, cam.pitch - (y - py) * 0.25))
    } : panBy(cam, view(), px, py, x, y);
    px = x;
    py = y;
});
const up = ()=>{
    dragging = false;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const [x, y] = at(e);
    cam = zoomAt(cam, view(), x, y, Math.exp(e.deltaY * 0.0015));
}, {
    passive: false
});
document.getElementById('mic').addEventListener('click', async ()=>{
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });
        const ctx = new AudioContext();
        const analyser = configure(ctx.createAnalyser());
        ctx.createMediaStreamSource(stream).connect(analyser);
        if (player) {
            player.src.stop();
            player.ctx.close();
            player = null;
        }
        mic = {
            analyser,
            bins: new Uint8Array(BANDS)
        };
        status.textContent = 'マイクの音で踊っています';
    } catch (err) {
        status.textContent = `マイクを使えません (${err.name})。内蔵のリズムで踊ります`;
    }
});
document.getElementById('play').addEventListener('click', ()=>{
    if (!rhythm) return;
    if (player) {
        player.src.stop();
        player.ctx.close();
        player = null;
        mic = null;
        status.textContent = '内蔵のリズム (無音) で踊っています';
        return;
    }
    const ctx = new AudioContext(), src = ctx.createBufferSource(), analyser = configure(ctx.createAnalyser());
    src.buffer = rhythm.loop;
    src.loop = true;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    src.start();
    player = {
        ctx,
        src
    };
    mic = {
        analyser,
        bins: new Uint8Array(BANDS)
    };
    status.textContent = '内蔵のリズムを鳴らして踊っています';
});
const t0 = performance.now();
const res = await fetch('../../../data/baked/mapbox-044-dancing-buildings/dance.bin');
if (!res.ok) throw new Error(`dance.bin: HTTP ${res.status}`);
const data = decode(await res.arrayBuffer());
renderer = createRenderer(gl, data);
draw(cam, levels, 0);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now();
status.textContent = `${data.buildings.toLocaleString()} 棟。リズムを解析中…`;
const t1 = performance.now();
const rhythmReady = analyseRhythm().then((r)=>{
    rhythm = r;
    if (!mic && !player) status.textContent = `${data.buildings.toLocaleString()} 棟。内蔵のリズム (無音) で踊っています`;
    return {
        ms: performance.now() - t1,
        r
    };
});
requestAnimationFrame(frame);
window.__dance = {
    gl,
    renderer,
    data,
    firstFrameMs,
    fetchStartMs: t0,
    rhythmReady,
    get cam () {
        return cam;
    },
    set cam (c){
        cam = c;
    },
    view,
    draw,
    stop () {
        running = false;
    }
};
if (location.search.includes('bench')) import('./bench.js');
