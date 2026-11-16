import { createPointCloudRenderer } from './render.js';
const canvas = document.getElementById('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const renderer = createPointCloudRenderer(canvas);
window.__mfsRenderer = renderer;
window.addEventListener('resize', ()=>{
    renderer.resize(window.innerWidth, window.innerHeight);
});
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.6;
let pitch = 0.45;
let dist = 160.0;
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
const btnPlay = document.getElementById('btn-play');
const rangeSpeed = document.getElementById('range-speed');
const rangeSize = document.getElementById('range-size');
let playing = true;
btnPlay?.addEventListener('click', ()=>{
    playing = !playing;
    renderer.togglePlay(playing);
    btnPlay.textContent = playing ? 'Pause' : 'Play';
});
rangeSpeed?.addEventListener('input', (e)=>{
    renderer.setSpeed(parseFloat(e.target.value));
});
rangeSize?.addEventListener('input', (e)=>{
    renderer.setPointSize(parseFloat(e.target.value));
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
