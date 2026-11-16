import { generateSphereMesh, generateFlightArcsGeometry } from './globe.js';
import { GlobeRenderer } from './render.js';
const canvas = document.getElementById('map');
const sphere = generateSphereMesh(64, 64);
const arcs = generateFlightArcsGeometry();
const renderer = new GlobeRenderer(canvas, sphere, arcs);
let yaw = 35;
let pitch = 22;
let distance = 2.85;
function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    renderer.render(yaw, pitch, distance);
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
    yaw += dx * 0.45;
    pitch = Math.max(-85, Math.min(85, pitch + dy * 0.45));
    renderer.render(yaw, pitch, distance);
});
window.addEventListener('mouseup', ()=>{
    isDragging = false;
});
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    distance = Math.max(1.3, Math.min(8.0, distance + e.deltaY * 0.003));
    renderer.render(yaw, pitch, distance);
}, {
    passive: false
});
window.__mfsRenderer = renderer;
if (location.search.includes('bench')) {
    import('./bench.js');
}
