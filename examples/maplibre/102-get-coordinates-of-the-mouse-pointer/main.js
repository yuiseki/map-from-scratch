import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/maplibre-102-get-coordinates-of-the-mouse-pointer/land.json');
const firstFrameMs = performance.now() - started;
const info = document.getElementById('info');
function updateInfo() {
    if (!info) return;
    const p = map.pointer;
    info.textContent = p ? `[${Math.round(p.x)}, ${Math.round(p.y)}]\n[${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}]` : 'Move the pointer over the map';
}
canvas.addEventListener('pointermove', updateInfo);
canvas.addEventListener('pointerleave', updateInfo);
updateInfo();
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
