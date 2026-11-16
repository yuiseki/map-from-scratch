import { createShadowsRenderer } from './render.js';
const canvas = document.getElementById('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const renderer = createShadowsRenderer(canvas);
window.__mfsRenderer = renderer;
window.addEventListener('resize', ()=>{
    renderer.resize(window.innerWidth, window.innerHeight);
});
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.7;
let pitch = 0.4;
let dist = 140.0;
canvas.addEventListener('mousedown', (e)=>{
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
});
window.addEventListener('mousemove', (e)=>{
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw -= dx * 0.008;
    pitch += dy * 0.008;
    renderer.setCameraAngles(yaw, pitch);
});
window.addEventListener('mouseup', ()=>{
    isDragging = false;
});
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    dist += e.deltaY * 0.12;
    renderer.setCameraDistance(dist);
}, {
    passive: false
});
const chkShadows = document.getElementById('chk-shadows');
const chkRotateSun = document.getElementById('chk-rotate-sun');
const rangeElevation = document.getElementById('range-elevation');
let currentAzimuth = 0.8;
let currentElevation = 0.55;
chkShadows?.addEventListener('change', (e)=>{
    renderer.toggleShadows(e.target.checked);
});
chkRotateSun?.addEventListener('change', (e)=>{
    renderer.toggleAutoRotate(e.target.checked);
});
rangeElevation?.addEventListener('input', (e)=>{
    currentElevation = parseFloat(e.target.value) / 180 * Math.PI;
    renderer.setSunAngles(currentAzimuth, currentElevation);
});
let lastTime = performance.now();
function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    renderer.render(dt);
    requestAnimationFrame(loop);
}
const params = new URLSearchParams(window.location.search);
if (params.has('bench')) {
    import('./bench.js');
} else {
    requestAnimationFrame(loop);
}
