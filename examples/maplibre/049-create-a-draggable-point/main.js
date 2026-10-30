import { mount } from './point.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/maplibre-049-create-a-draggable-point/land.json');
const firstFrameMs = performance.now() - started;
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
