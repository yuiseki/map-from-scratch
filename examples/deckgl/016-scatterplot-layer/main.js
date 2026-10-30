import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/deckgl-016-scatterplot-layer/points.bin');
const firstFrameMs = performance.now() - started;
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
