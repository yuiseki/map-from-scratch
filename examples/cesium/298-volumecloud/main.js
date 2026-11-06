import { createVolumeCloudRenderer } from './render.js';
const canvas = document.getElementById('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const renderer = createVolumeCloudRenderer(canvas);
window.__mfsRenderer = renderer;
window.addEventListener('resize', ()=>{
    renderer.resize(window.innerWidth, window.innerHeight);
});
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.5;
let pitch = 0.25;
let dist = 46.0;
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
    yaw -= dx * 0.007;
    pitch += dy * 0.007;
    renderer.setCameraAngles(yaw, pitch);
});
window.addEventListener('mouseup', ()=>{
    isDragging = false;
});
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    dist += e.deltaY * 0.05;
    renderer.setCameraDistance(dist);
}, {
    passive: false
});
const chkRotate = document.getElementById('chk-rotate');
const rangeCoverage = document.getElementById('range-coverage');
const rangeSun = document.getElementById('range-sun');
chkRotate?.addEventListener('change', (e)=>{
    renderer.toggleAutoRotate(e.target.checked);
});
rangeCoverage?.addEventListener('input', (e)=>{
    const coverage = parseFloat(e.target.value) / 100;
    renderer.setCloudCoverage(coverage);
});
rangeSun?.addEventListener('input', (e)=>{
    const el = parseFloat(e.target.value) / 180 * Math.PI;
    renderer.setSunAngles(1.0, el);
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
