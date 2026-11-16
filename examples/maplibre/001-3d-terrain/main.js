import { generateTerrainMesh } from './terrain.js';
import { TerrainRenderer } from './render.js';
const canvas = document.getElementById('map');
const mesh = generateTerrainMesh(128, 128, 22000);
const renderer = new TerrainRenderer(canvas, mesh);
let pitch = 70;
let bearing = -45;
let distance = 24000;
function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    renderer.render(pitch, bearing, distance);
}
window.addEventListener('resize', resize);
resize();
let isDragging = false;
let startX = 0;
let startY = 0;
canvas.addEventListener('mousedown', (e)=>{
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
});
window.addEventListener('mousemove', (e)=>{
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = e.clientX;
    startY = e.clientY;
    bearing += dx * 0.35;
    pitch = Math.max(15, Math.min(85, pitch + dy * 0.35));
    renderer.render(pitch, bearing, distance);
});
window.addEventListener('mouseup', ()=>{
    isDragging = false;
});
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    distance = Math.max(8000, Math.min(60000, distance + e.deltaY * 20));
    renderer.render(pitch, bearing, distance);
}, {
    passive: false
});
window.__mfsRenderer = renderer;
if (location.search.includes('bench')) {
    import('./bench.js');
}
