import { mount } from './fit.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/maplibre-096-fit-a-map-to-a-bounding-box/land.json');
const firstFrameMs = performance.now() - started;
document.getElementById('fit')?.addEventListener('click', ()=>{
    map.fitBounds();
});
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
