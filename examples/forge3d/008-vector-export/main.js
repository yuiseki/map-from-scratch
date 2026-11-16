import { VectorExportMap } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new VectorExportMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;
document.getElementById('export-btn').addEventListener('click', ()=>{
    const blob = new Blob([
        map.exportSvg()
    ], {
        type: 'image/svg+xml'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'luxembourg-rail.svg';
    a.click();
    URL.revokeObjectURL(a.href);
});
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
