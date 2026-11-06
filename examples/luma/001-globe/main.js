import { GlobeRenderer } from './render.js';
const canvas = document.getElementById('canvas');
const fpsEl = document.getElementById('fps');
const autoRotateCheck = document.getElementById('autoRotate');
const sunAngleRange = document.getElementById('sunAngle');
const distanceRange = document.getElementById('distance');
const renderer = new GlobeRenderer(canvas);
window.__mfsRenderer = renderer;
autoRotateCheck.addEventListener('change', ()=>{
    renderer.state.autoRotate = autoRotateCheck.checked;
});
sunAngleRange.addEventListener('input', ()=>{
    renderer.state.sunAngle = parseFloat(sunAngleRange.value);
});
distanceRange.addEventListener('input', ()=>{
    renderer.state.distance = parseFloat(distanceRange.value);
});
let lastTime = performance.now();
let frames = 0;
let lastFpsUpdate = lastTime;
function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    renderer.render(dt);
    frames++;
    if (now - lastFpsUpdate >= 500) {
        const fps = Math.round(frames * 1000 / (now - lastFpsUpdate));
        fpsEl.textContent = `FPS: ${fps}`;
        frames = 0;
        lastFpsUpdate = now;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (location.search.includes('bench')) {
    import('./bench.js').then((mod)=>mod.run());
}
