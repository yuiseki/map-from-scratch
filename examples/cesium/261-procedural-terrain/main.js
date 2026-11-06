import { ProceduralTerrainRenderer } from './render.js';
const canvas = document.getElementById('canvas');
const fpsEl = document.getElementById('fps');
const waterSlider = document.getElementById('waterSlider');
const snowSlider = document.getElementById('snowSlider');
const sunSlider = document.getElementById('sunSlider');
const autoRotateCheck = document.getElementById('autoRotate');
const renderer = new ProceduralTerrainRenderer(canvas);
window.__mfsRenderer = renderer;
waterSlider.addEventListener('input', ()=>{
    renderer.state.waterLevel = parseFloat(waterSlider.value);
});
snowSlider.addEventListener('input', ()=>{
    renderer.state.snowLevel = parseFloat(snowSlider.value);
});
sunSlider.addEventListener('input', ()=>{
    renderer.state.sunAngle = parseFloat(sunSlider.value);
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
        frames = 0;
        lastFpsUpdate = now;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (location.search.includes('bench')) {
    import('./bench.js');
}
