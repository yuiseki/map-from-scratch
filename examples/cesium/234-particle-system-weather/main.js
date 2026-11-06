import { WeatherRenderer } from './render.js';
const canvas = document.getElementById('canvas');
const fpsEl = document.getElementById('fps');
const weatherTypeSelect = document.getElementById('weatherType');
const windSlider = document.getElementById('windSlider');
const autoRotateCheck = document.getElementById('autoRotate');
const renderer = new WeatherRenderer(canvas);
window.__mfsRenderer = renderer;
weatherTypeSelect.addEventListener('change', ()=>{
    renderer.setWeatherType(weatherTypeSelect.value);
});
windSlider.addEventListener('input', ()=>{
    renderer.state.windSpeed = parseFloat(windSlider.value);
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
