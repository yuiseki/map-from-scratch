import { generateNycCensusTracts, buildCensusMesh, CENSUS_CENTER } from './census.js';
import { CensusRenderer } from './render.js';
const canvas = document.getElementById('map');
const tracts = generateNycCensusTracts();
const mesh = buildCensusMesh(tracts, CENSUS_CENTER);
const renderer = new CensusRenderer(canvas, mesh);
let pitch = 55;
let bearing = -22;
let distance = 9500;
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
    pitch = Math.max(10, Math.min(85, pitch + dy * 0.35));
    renderer.render(pitch, bearing, distance);
});
window.addEventListener('mouseup', ()=>{
    isDragging = false;
});
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    distance = Math.max(2000, Math.min(30000, distance + e.deltaY * 8));
    renderer.render(pitch, bearing, distance);
}, {
    passive: false
});
window.__mfsRenderer = renderer;
if (location.search.includes('bench')) {
    import('./bench.js');
}
