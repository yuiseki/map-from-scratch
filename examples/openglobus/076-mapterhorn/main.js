import { decodeTerrarium, createTerrainMesh, orbitCamera, zoomTerrain } from './terrain.js';
import { TerrainRenderer } from './render.js';
const pageStart = window.__mfsPageStart ?? performance.now();
const canvas = document.getElementById('terrain');
const readout = document.getElementById('readout');
const image = new Image();
image.src = './terrain.webp';
await image.decode();
const scratch = document.createElement('canvas');
scratch.width = image.naturalWidth;
scratch.height = image.naturalHeight;
const ctx = scratch.getContext('2d', {
    willReadFrequently: true
});
ctx.drawImage(image, 0, 0);
const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
const rgba = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
const elevations = decodeTerrarium(rgba, scratch.width, scratch.height);
let min = Infinity, max = -Infinity;
for (const height of elevations){
    min = Math.min(min, height);
    max = Math.max(max, height);
}
const mesh = createTerrainMesh(elevations, scratch.width, scratch.height, 128, 128, 0.0012);
const renderer = new TerrainRenderer(canvas, mesh);
let yaw = -0.35;
let pitch = 0.82;
let distance = 3.6;
let dragging = false;
let px = 0;
let py = 0;
const bench = new URLSearchParams(location.search).has('bench');
let firstFrame = 0;
function draw() {
    renderer.render(yaw, pitch, distance);
    if (!firstFrame) firstFrame = performance.now() - pageStart;
    readout.textContent = `z12 · tile 3627/1615\n標高 ${Math.round(min)}–${Math.round(max)} m · GPU 128² mesh`;
}
function resize() {
    renderer.resize(canvas.clientWidth, canvas.clientHeight);
    draw();
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
    [yaw, pitch] = orbitCamera(yaw, pitch, event.clientX - px, event.clientY - py);
    px = event.clientX;
    py = event.clientY;
    draw();
});
canvas.addEventListener('pointerup', ()=>{
    dragging = false;
});
canvas.addEventListener('pointercancel', ()=>{
    dragging = false;
});
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    distance = zoomTerrain(distance, event.deltaY);
    draw();
}, {
    passive: false
});
window.__mfsTerrain = renderer;
window.__mfsTerrainFirstFrame = ()=>firstFrame;
if (bench) void import('./bench.js').then(({ run })=>run(renderer, ()=>firstFrame));
