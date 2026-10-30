import { MapboxAnimatedLineMap } from './map.js';
const canvas = document.getElementById('map');
const map = new MapboxAnimatedLineMap(canvas);
window.__map = map;
await map.load();
map.startAnimation();
if (location.search.includes('bench')) {
    await import('./bench.js');
}
