import { dragCamera, zoomCamera } from './camera.js';
import { GlobeRenderer } from './globe.js';
import { SLIDERS, paramsFrom } from './shading.js';
import { subsolarPoint, sunDirection } from './sun.js';
import { PLAY_HOURS_PER_SECOND, advance, formatUtc, minuteOfDay, withMinute } from './timeline.js';
const DATA = '../../../data/baked/openglobus-043-lighting/';
const pageStart = window.__mfsPageStart ?? 0;
const bench = new URLSearchParams(location.search).has('bench');
const load = (name)=>{
    const img = new Image();
    img.src = DATA + name;
    return img.decode().then(()=>img);
};
const [day, water, lights] = await Promise.all([
    load('earth.jpg'),
    load('water.png'),
    load('lights.png')
]);
const canvas = document.getElementById('globe');
const renderer = new GlobeRenderer(canvas, day, water, lights);
const values = Object.fromEntries(SLIDERS.map((s)=>[
        s.id,
        s.value
    ]));
let atmosphere = true;
let time = Date.now();
const sub = subsolarPoint(new Date(time));
let camera = {
    lon: (sub.lon + 240) % 360 - 180,
    lat: 20,
    distance: 3
};
let playing = false;
let frames = 0;
let firstFrameMs = 0;
let pending = false;
let last = 0;
const $ = (id)=>document.getElementById(id);
const timeSlider = $('time');
const dateInput = $('date');
const timeLabel = $('time-label');
const playButton = $('play');
const panel = $('sliders');
for (const s of SLIDERS){
    const row = document.createElement('label');
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" data-id="${s.id}"><output>${s.value}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.addEventListener('input', ()=>{
        values[s.id] = Number(input.value);
        out.textContent = input.value;
        request();
    });
    panel.append(row);
}
$('atmosphere').addEventListener('change', (e)=>{
    atmosphere = e.target.checked;
    request();
});
function showTime() {
    timeSlider.value = String(minuteOfDay(time));
    dateInput.value = new Date(time).toISOString().slice(0, 10);
    timeLabel.textContent = formatUtc(time);
}
timeSlider.addEventListener('input', ()=>{
    time = withMinute(time, Number(timeSlider.value));
    showTime();
    request();
});
dateInput.addEventListener('change', ()=>{
    const d = Date.parse(dateInput.value + 'T00:00:00Z');
    if (Number.isFinite(d)) {
        time = d + minuteOfDay(time) * 60_000;
        showTime();
        request();
    }
});
playButton.addEventListener('click', ()=>{
    playing = !playing;
    playButton.textContent = playing ? '❚❚' : '▶';
    playButton.setAttribute('aria-pressed', String(playing));
    last = 0;
    request();
});
$('now').addEventListener('click', ()=>{
    time = Date.now();
    showTime();
    request();
});
let dragging = false, px = 0, py = 0;
canvas.addEventListener('pointerdown', (e)=>{
    dragging = true;
    px = e.clientX;
    py = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    camera = dragCamera(camera, e.clientX - px, e.clientY - py, canvas.clientHeight);
    px = e.clientX;
    py = e.clientY;
    request();
});
const stop = ()=>{
    dragging = false;
};
canvas.addEventListener('pointerup', stop);
canvas.addEventListener('pointercancel', stop);
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    camera = zoomCamera(camera, e.deltaY);
    request();
}, {
    passive: false
});
function resize() {
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    request();
}
new ResizeObserver(resize).observe(canvas);
function draw() {
    renderer.render({
        camera,
        sun: sunDirection(new Date(time)),
        params: paramsFrom(values, atmosphere)
    });
    frames++;
}
function frame(now) {
    pending = false;
    if (playing) {
        time = advance(time, last ? (now - last) / 1000 : 0, PLAY_HOURS_PER_SECOND);
        last = now;
        showTime();
    }
    draw();
    if (!firstFrameMs) firstFrameMs = performance.now() - pageStart;
    if (playing) request();
}
function request() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(frame);
}
showTime();
resize();
const app = {
    renderer,
    values,
    frames: ()=>frames,
    firstFrameMs: ()=>firstFrameMs,
    state: ()=>({
            camera,
            time,
            atmosphere,
            playing
        }),
    set: (s)=>{
        if (s.camera) camera = s.camera;
        if (s.time !== undefined) {
            time = s.time;
            showTime();
        }
        if (s.atmosphere !== undefined) atmosphere = s.atmosphere;
    },
    drawNow: draw
};
if (bench) void import('./bench.js').then(({ run })=>run(app));
