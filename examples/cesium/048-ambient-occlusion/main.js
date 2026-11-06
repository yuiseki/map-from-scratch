import { createSSAORenderer } from './render.js';
const canvas = document.getElementById('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const renderer = createSSAORenderer(canvas);
window.__mfsRenderer = renderer;
window.addEventListener('resize', ()=>{
    renderer.resize(window.innerWidth, window.innerHeight);
});
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.75;
let pitch = 0.42;
let dist = 75.0;
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
    dist += e.deltaY * 0.08;
    renderer.setCameraDistance(dist);
}, {
    passive: false
});
const chkSSAO = document.getElementById('chk-ssao');
const chkRotate = document.getElementById('chk-rotate');
const rangeIntensity = document.getElementById('range-intensity');
const rangeRadius = document.getElementById('range-radius');
chkSSAO?.addEventListener('change', (e)=>{
    renderer.toggleSSAO(e.target.checked);
});
chkRotate?.addEventListener('change', (e)=>{
    renderer.toggleAutoRotate(e.target.checked);
});
rangeIntensity?.addEventListener('input', (e)=>{
    renderer.setIntensity(parseFloat(e.target.value));
});
rangeRadius?.addEventListener('input', (e)=>{
    renderer.setRadius(parseFloat(e.target.value));
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
