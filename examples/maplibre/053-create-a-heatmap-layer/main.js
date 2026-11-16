import { MaplibreHeatmapMap } from './map.js';
const canvas = document.getElementById('map');
const map = new MaplibreHeatmapMap(canvas);
window.__map = map;
await map.load();
if (location.search.includes('bench')) {
    await import('./bench.js');
}
