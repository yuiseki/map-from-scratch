import { mount } from './polygon.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/maplibre-041-change-a-layers-color-with-buttons/box.json', '../../../data/baked/maplibre-041-change-a-layers-color-with-buttons/land.json');
const firstFrameMs = performance.now() - started;
for (const btn of document.querySelectorAll('[data-color]')){
    btn.addEventListener('click', ()=>map.setFillColor(btn.dataset.color));
}
document.getElementById('random')?.addEventListener('click', ()=>{
    const c = crypto.getRandomValues(new Uint8Array(3));
    map.setFillColor(`#${Array.from(c, (v)=>v.toString(16).padStart(2, '0')).join('')}`);
});
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
