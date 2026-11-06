import { mount } from './line.js';
const started = performance.now();
const canvas = document.getElementById('map-canvas');
const dataUrl = new URL('../../../data/baked/maplibre-031-animate-a-line/land.json', import.meta.url).href;
const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;
const stepCount = document.getElementById('step-count');
const btnToggle = document.getElementById('btn-toggle');
const btnReset = document.getElementById('btn-reset');
let active = true;
map.start();
setInterval(()=>{
    stepCount.textContent = `Point: ${map.getPointCount()} / 360`;
}, 100);
btnToggle.addEventListener('click', ()=>{
    active = !active;
    btnToggle.textContent = active ? 'Pause' : 'Play';
    if (active) map.start();
    else map.stop();
});
btnReset.addEventListener('click', ()=>{
    map.reset();
    stepCount.textContent = `Point: 0 / 360`;
});
if (window.location.search.includes('bench')) {
    map.stop();
    map.reset();
    import('./bench.js').then((mod)=>mod.runBench(map, firstFrameMs));
}
