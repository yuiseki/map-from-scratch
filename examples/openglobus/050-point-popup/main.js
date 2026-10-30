import { PopupPointsMap } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new PopupPointsMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
