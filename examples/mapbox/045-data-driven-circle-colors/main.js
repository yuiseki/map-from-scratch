import { DataDrivenCirclesMap } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const land = document.getElementById('land');
const map = new DataDrivenCirclesMap(canvas, land);
window.__map = map;
await map.load();
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
const status = document.getElementById('status');
if (status) status.textContent = `${map.count.toLocaleString('ja-JP')} 地点 · M${map.magMin.toFixed(1)}–${map.magMax.toFixed(1)}`;
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
