import { MapPlate } from './map.js';
const canvas = document.getElementById('map');
const plate = new MapPlate(canvas);
window.__map = plate;
await plate.load();
if (location.search.includes('bench')) {
    await import('./bench.js');
}
