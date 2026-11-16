import { CesiumPointsGlobe } from './globe.js';
const canvas = document.getElementById('map');
const globe = new CesiumPointsGlobe(canvas);
window.__map = globe;
await globe.load();
if (location.search.includes('bench')) {
    await import('./bench.js');
}
