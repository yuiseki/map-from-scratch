import { mount } from './map.js';
const canvas = document.getElementById('canvas');
const canvasHtml = document.getElementById('canvas-html');
const hudGpu = document.getElementById('hud-gpu');
const hudUploads = document.getElementById('hud-uploads');
const hudRelayouts = document.getElementById('hud-relayouts');
const hudCount = document.getElementById('hud-count');
const btnUpdate = document.getElementById('btn-update');
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
const DATA_URL = '../../../data/baked/htmlcanvas-002-webgpu-map-label/landmarks.json';
const startTime = performance.now();
const mapInstance = await mount(canvas, canvasHtml, DATA_URL);
const firstFrameMs = performance.now() - startTime;
window.addEventListener('resize', ()=>{
    resize();
    mapInstance.render();
});
let relayoutCount = 1;
function updateHud() {
    if (hudGpu) hudGpu.textContent = mapInstance.gpuName;
    if (hudCount) hudCount.textContent = String(mapInstance.landmarks.length);
    if (hudUploads) hudUploads.textContent = String(mapInstance.textureUploadCount);
    if (hudRelayouts) hudRelayouts.textContent = String(relayoutCount);
}
const originalRender = mapInstance.render;
mapInstance.render = async ()=>{
    await originalRender();
    updateHud();
};
updateHud();
if (btnUpdate) {
    btnUpdate.addEventListener('click', async ()=>{
        relayoutCount++;
        await mapInstance.updateLabelContent(0, '東京タワー [更新]', '人気スポット', '★ 4.9');
        updateHud();
    });
}
if (new URLSearchParams(window.location.search).has('bench')) {
    const { runBench } = await import('./bench.js');
    await runBench(mapInstance, firstFrameMs);
}
