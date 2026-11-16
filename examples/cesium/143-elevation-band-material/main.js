import { ElevationRenderer } from './render.js';
const canvas = document.getElementById('canvas');
const fpsEl = document.getElementById('fps');
const autoRotateCheck = document.getElementById('autoRotate');
const paletteSelect = document.getElementById('palette');
const contoursSelect = document.getElementById('contours');
const renderer = new ElevationRenderer(canvas);
window.__mfsRenderer = renderer;
autoRotateCheck.addEventListener('change', ()=>{
    renderer.state.autoRotate = autoRotateCheck.checked;
});
paletteSelect.addEventListener('change', ()=>{
    renderer.state.paletteMode = parseInt(paletteSelect.value, 10);
});
contoursSelect.addEventListener('change', ()=>{
    renderer.state.contourInterval = parseFloat(contoursSelect.value);
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
