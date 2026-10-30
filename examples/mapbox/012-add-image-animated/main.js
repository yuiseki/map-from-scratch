import { mount } from './pulsing-dot.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/mapbox-012-add-image-animated/land.json');
const firstFrameMs = performance.now() - started;
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
