import { VancouverMap } from './renderer.js';
const started = performance.now();
const base = '../../../data/baked/deckgl-007-geojson-layer-polygons/';
const [meshResponse, valuesResponse] = await Promise.all([
    fetch(base + 'mesh.bin'),
    fetch(base + 'values.json')
]);
if (!meshResponse.ok || !valuesResponse.ok) throw new Error(`data HTTP ${meshResponse.status}/${valuesResponse.status}`);
const map = new VancouverMap(document.getElementById('map'), await meshResponse.arrayBuffer(), await valuesResponse.json());
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
const status = document.getElementById('status');
const updateStatus = ()=>{
    status.textContent = `${map.blockCount.toLocaleString('ja-JP')} 区画 · zoom ${map.zoom.toFixed(1)} · 傾斜 ${map.pitch.toFixed(0)}°`;
};
updateStatus();
const canvas = map.canvas, tooltip = document.getElementById('tooltip');
let drag = null;
canvas.addEventListener('contextmenu', (event)=>event.preventDefault());
canvas.addEventListener('pointerdown', (event)=>{
    drag = {
        x: event.clientX,
        y: event.clientY,
        rotate: event.button === 2 || event.shiftKey
    };
    canvas.setPointerCapture(event.pointerId);
    tooltip.style.display = 'none';
});
canvas.addEventListener('pointerup', ()=>{
    drag = null;
});
canvas.addEventListener('pointercancel', ()=>{
    drag = null;
});
canvas.addEventListener('pointermove', (event)=>{
    if (drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (drag.rotate) map.rotate(dx, dy);
        else map.pan(dx, dy);
        drag.x = event.clientX;
        drag.y = event.clientY;
        updateStatus();
        return;
    }
    const picked = map.pick(event.clientX, event.clientY);
    tooltip.style.display = picked ? 'block' : 'none';
    if (picked) {
        tooltip.textContent = `${Math.round(picked.valuePerSqm).toLocaleString('ja-JP')} / m² · 伸び率 ${(picked.growth * 100).toFixed(1)}%`;
        tooltip.style.left = `${event.clientX + 12}px`;
        tooltip.style.top = `${event.clientY + 12}px`;
    }
});
canvas.addEventListener('pointerleave', ()=>{
    tooltip.style.display = 'none';
});
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    map.zoomBy(Math.exp(-event.deltaY * 0.0015));
    updateStatus();
}, {
    passive: false
});
window.addEventListener('resize', ()=>map.resize());
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, firstFrameMs);
