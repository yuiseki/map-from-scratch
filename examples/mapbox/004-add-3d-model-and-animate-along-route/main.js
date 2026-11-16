import { EarthRenderer, rotateCamera, zoomDistance } from './globe.js';
import { drawFlightOverlay } from './flight.js';
const canvas = document.getElementById('earth');
const overlay = document.getElementById('flight');
const image = new Image();
image.src = './earth.jpg';
await image.decode();
const renderer = new EarthRenderer(canvas, image);
const ctx = overlay.getContext('2d', {
    alpha: true
});
if (!ctx) throw new Error('Canvas 2D is required for the aircraft overlay');
let yaw = 1.1;
let pitch = -0.12;
let distance = 3.45;
let dragging = false;
let px = 0;
let py = 0;
const queryBench = new URLSearchParams(location.search).has('bench');
const pageStart = window.__mfsPageStart ?? performance.now();
let firstFrameMs = 0;
function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    overlay.width = Math.max(1, Math.round(overlay.clientWidth * dpr));
    overlay.height = Math.max(1, Math.round(overlay.clientHeight * dpr));
}
window.addEventListener('resize', resize);
resize();
canvas.addEventListener('pointerdown', (event)=>{
    dragging = true;
    px = event.clientX;
    py = event.clientY;
    canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event)=>{
    if (!dragging) return;
    [yaw, pitch] = rotateCamera(yaw, pitch, event.clientX - px, event.clientY - py);
    px = event.clientX;
    py = event.clientY;
});
canvas.addEventListener('pointerup', ()=>{
    dragging = false;
});
canvas.addEventListener('pointercancel', ()=>{
    dragging = false;
});
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    distance = zoomDistance(distance, event.deltaY);
}, {
    passive: false
});
const start = performance.now();
let lastFrame = 0;
function draw(timeMs) {
    const elapsed = timeMs - start;
    renderer.render(yaw, pitch, distance);
    const dpr = overlay.width / Math.max(1, overlay.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFlightOverlay(ctx, overlay.clientWidth, overlay.clientHeight, yaw, pitch, distance, elapsed);
}
function frame(now) {
    if (!dragging && !queryBench && lastFrame) yaw += Math.min(0.05, (now - lastFrame) / 1000) * 0.055;
    lastFrame = now;
    draw(now - start);
    if (!firstFrameMs) firstFrameMs = performance.now() - pageStart;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__mfsFlight = {
    draw,
    overlay
};
window.__mfsFirstFrame = ()=>firstFrameMs;
if (queryBench) {
    void import('./bench.js').then(({ run })=>run(renderer, draw, overlay, ()=>firstFrameMs));
}
