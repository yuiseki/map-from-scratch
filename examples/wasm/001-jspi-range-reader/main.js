import { mount } from './map.js';
async function init() {
    const canvas = document.getElementById('canvas');
    const readsEl = document.getElementById('reads-val');
    const bytesEl = document.getElementById('bytes-val');
    const tilesEl = document.getElementById('tiles-val');
    const startTime = performance.now();
    const archiveUrl = '../../../data/baked/wasm-001-jspi-range-reader/world.pmtiles';
    const map = await mount(canvas, archiveUrl);
    const firstFrameMs = performance.now() - startTime;
    window.__jspiMap = map;
    function updateHud() {
        if (readsEl) readsEl.textContent = `${map.getRangeReadCount().toLocaleString()} requests`;
        if (bytesEl) bytesEl.textContent = `${(map.getRangeBytes() / 1024).toFixed(1)} KB`;
        if (tilesEl) tilesEl.textContent = `${map.getTileCount()} tiles`;
    }
    updateHud();
    canvas.addEventListener('pointermove', updateHud);
    canvas.addEventListener('wheel', updateHud);
    if (location.search.includes('bench')) {
        const { runBench } = await import('./bench.js');
        await runBench(map, firstFrameMs);
    }
}
init().catch((err)=>{
    console.error('Initialization error:', err);
    const hud = document.getElementById('hud');
    if (hud) {
        hud.innerHTML = `<span style="color:#ef4444">JSPI Error: ${err.message}</span>`;
    }
    if (window.__mfsEmit) {
        window.__mfsEmit(JSON.stringify({
            error: err?.message || String(err)
        }));
    }
    throw err;
});
