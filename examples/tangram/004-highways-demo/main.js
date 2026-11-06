import { TangramHighwaysMap } from './map.js';
const canvas = document.getElementById('map');
const map = new TangramHighwaysMap(canvas);
window.__map = map;
await map.load();
if (location.search.includes('bench')) {
    await import('./bench.js');
}
