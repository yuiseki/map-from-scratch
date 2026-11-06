import { MapboxAntPathMap } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new MapboxAntPathMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;
map.startAnimation();
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
