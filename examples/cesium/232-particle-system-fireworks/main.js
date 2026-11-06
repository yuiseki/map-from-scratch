import { FireworksRenderer } from './render.js';
const canvas = document.getElementById('canvas');
const fpsEl = document.getElementById('fps');
const particleCountEl = document.getElementById('particleCount');
const autoRotateCheck = document.getElementById('autoRotate');
const launchBtn = document.getElementById('launchBtn');
const renderer = new FireworksRenderer(canvas);
window.__mfsRenderer = renderer;
autoRotateCheck.addEventListener('change', ()=>{
    renderer.camera.autoRotate = autoRotateCheck.checked;
});
launchBtn.addEventListener('click', ()=>{
    renderer.sim.launchRocket(0, 0, [
        1.0,
        0.85,
        0.1
    ]);
    renderer.sim.burst([
        0,
        450,
        0
    ], [
        1.0,
        0.2,
        0.5
    ], 250, 240);
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
        particleCountEl.textContent = `Particles: ${renderer.sim.getParticleCount()}`;
        frames = 0;
        lastFpsUpdate = now;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (location.search.includes('bench')) {
    import('./bench.js');
}
