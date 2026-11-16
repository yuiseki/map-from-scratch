import { createMapboxDefaultBuildings, generateSkyscraperPrisms, MAPBOX_DEFAULT_CENTER } from './buildings.js';
import { MapboxBuildingRenderer } from './render.js';
const canvas = document.getElementById('map');
const skyscrapers = createMapboxDefaultBuildings();
const mesh = generateSkyscraperPrisms(skyscrapers, MAPBOX_DEFAULT_CENTER);
const renderer = new MapboxBuildingRenderer(canvas, mesh);
let pitch = 45;
let bearing = -17.6;
let distance = 920;
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
    distance = Math.max(200, Math.min(3000, distance + e.deltaY * 0.8));
    renderer.render(pitch, bearing, distance);
}, {
    passive: false
});
window.__mfsRenderer = renderer;
if (location.search.includes('bench')) {
    import('./bench.js');
}
