import { mount } from './map.js';
const canvas = document.getElementById('canvas');
const hudStatus = document.getElementById('hud-status');
const hudAnchor = document.getElementById('hud-anchor');
const hudBookmark = document.getElementById('hud-bookmark');
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
const DATA_URL = '../../../data/baked/htmlcanvas-001-rich-map-popup/landmarks.json';
const startTime = performance.now();
let view = null;
const mapInstance = view = await mount(canvas, DATA_URL, ()=>updateHud());
const firstFrameMs = performance.now() - startTime;
window.addEventListener('resize', ()=>{
    resize();
    mapInstance.render();
});
function updateHud() {
    const mapInstance = view;
    if (!mapInstance) return;
    if (hudStatus) {
        hudStatus.textContent = mapInstance.htmlInCanvas ? 'HTML-in-Canvas (drawElementImage)' : 'DOM overlay (this browser has no HTML-in-Canvas)';
        hudStatus.style.color = mapInstance.htmlInCanvas ? '#4ade80' : '#f59e0b';
    }
    if (hudAnchor) hudAnchor.textContent = mapInstance.activeLandmark.name;
    if (hudBookmark) {
        hudBookmark.textContent = mapInstance.bookmarked ? 'Saved ✓' : 'No';
        hudBookmark.style.color = mapInstance.bookmarked ? '#4ade80' : '#94a3b8';
    }
}
updateHud();
if (new URLSearchParams(window.location.search).has('bench')) {
    const { runBench } = await import('./bench.js');
    await runBench(mapInstance, firstFrameMs);
}
