import { TemperatureMap } from './renderer.js';
const started = performance.now();
const response = await fetch('../../../data/baked/d3-016-geotiff-contours-ii/temperature.bin');
if (!response.ok) throw new Error(`temperature data: HTTP ${response.status}`);
const map = new TemperatureMap(document.getElementById('map'), await response.arrayBuffer());
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
const status = document.getElementById('status');
status.textContent = `${map.count.toLocaleString('ja-JP')} 格子点 · 5 °C 間隔`;
const step = document.getElementById('step');
step.addEventListener('input', ()=>{
    map.setStep(Number(step.value));
    document.getElementById('step-value').textContent = `${map.step} °C`;
    status.textContent = `${map.count.toLocaleString('ja-JP')} 格子点 · ${map.step} °C 間隔`;
});
window.addEventListener('resize', ()=>map.resize());
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, firstFrameMs);
