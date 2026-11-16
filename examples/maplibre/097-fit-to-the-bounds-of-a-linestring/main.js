import { mount } from './line.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/maplibre-097-fit-to-the-bounds-of-a-linestring/route.json', '../../../data/baked/maplibre-097-fit-to-the-bounds-of-a-linestring/land.json');
const firstFrameMs = performance.now() - started;
document.getElementById('zoomto')?.addEventListener('click', ()=>map.fitLine());
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
