import { Forge3dPointCloud } from './cloud.js';
const canvas = document.getElementById('map');
const cloud = new Forge3dPointCloud(canvas);
window.__map = cloud;
await cloud.load();
if (location.search.includes('bench')) {
    await import('./bench.js');
}
