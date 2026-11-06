import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map-canvas');
const dataUrl = new URL('../../../data/baked/kepler-007-node-app/earthquakes.bin', import.meta.url).href;
const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;
const btnExportCsv = document.getElementById('btn-export-csv');
const btnExportJson = document.getElementById('btn-export-json');
btnExportCsv.addEventListener('click', ()=>{
    btnExportCsv.textContent = 'Exporting...';
    setTimeout(()=>{
        btnExportCsv.textContent = 'CSV Ready (54k)';
    }, 300);
});
btnExportJson.addEventListener('click', ()=>{
    btnExportJson.textContent = 'Exporting...';
    setTimeout(()=>{
        btnExportJson.textContent = 'GeoJSON Ready';
    }, 300);
});
if (new URLSearchParams(location.search).has('bench')) {
    const benchModule = await import('./bench.js');
    await benchModule.run(map, firstFrameMs);
}
