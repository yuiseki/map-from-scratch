import { mount } from './overlay.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/mapbox-017-adjust-layer-opacity/overlay.png', '../../../data/baked/mapbox-017-adjust-layer-opacity/land.json');
const firstFrameMs = performance.now() - started;
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
