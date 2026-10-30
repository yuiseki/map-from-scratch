import { SunGlobe } from './globe.js';
const started = performance.now();
const canvas = document.getElementById('map');
const globe = new SunGlobe(canvas);
window.__map = globe;
await globe.load();
const firstFrameMs = performance.now() - started;
const slider = document.getElementById('sun');
const out = document.getElementById('sunOut');
const showSun = ()=>{
    const lon = Number(slider.value);
    globe.setSun(lon);
    out.textContent = `${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`;
};
slider.addEventListener('input', showSun);
showSun();
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(globe, firstFrameMs);
}
