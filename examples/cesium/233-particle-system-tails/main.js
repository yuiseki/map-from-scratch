import { TailsRenderer } from './render.js';
const canvas = document.getElementById('canvas');
const fpsEl = document.getElementById('fps');
const particleStatsEl = document.getElementById('particleStats');
const orbitSlider = document.getElementById('orbitSlider');
const rateSlider = document.getElementById('rateSlider');
const autoRotateCheck = document.getElementById('autoRotate');
const renderer = new TailsRenderer(canvas);
window.__mfsRenderer = renderer;
orbitSlider.addEventListener('input', ()=>{
    renderer.state.orbitSpeed = parseFloat(orbitSlider.value);
});
rateSlider.addEventListener('input', ()=>{
    renderer.state.emissionRate = parseInt(rateSlider.value, 10);
});
autoRotateCheck.addEventListener('change', ()=>{
    renderer.state.autoRotate = autoRotateCheck.checked;
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
        particleStatsEl.textContent = `Particles: ${renderer.getTotalParticles()}`;
        frames = 0;
        lastFpsUpdate = now;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (location.search.includes('bench')) {
    import('./bench.js');
}
