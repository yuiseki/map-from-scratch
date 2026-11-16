import { mount } from './map.js';
async function init() {
    const canvas = document.getElementById('canvas');
    const visibleEl = document.getElementById('visible-val');
    const startTime = performance.now();
    const dataUrl = '../../../data/baked/webgpu-001-gpu-driven-culling/buildings.bin';
    const map = await mount(canvas, dataUrl);
    const firstFrameMs = performance.now() - startTime;
    window.__cullingMap = map;
    async function updateHud() {
        if (!visibleEl) return;
        try {
            const visible = await map.getVisibleCount();
            visibleEl.textContent = `${visible.toLocaleString()} (${(visible / map.buildingCount * 100).toFixed(1)}%)`;
        } catch  {}
    }
    await updateHud();
    let hudDebounce = null;
    const triggerHudUpdate = ()=>{
        if (hudDebounce) return;
        hudDebounce = window.setTimeout(async ()=>{
            hudDebounce = null;
            await updateHud();
        }, 50);
    };
    canvas.addEventListener('pointermove', triggerHudUpdate);
    canvas.addEventListener('wheel', triggerHudUpdate);
    if (location.search.includes('bench')) {
        const { runBench } = await import('./bench.js');
        await runBench(map, firstFrameMs);
    }
}
init().catch((err)=>{
    console.error('Initialization error:', err);
    const hud = document.getElementById('hud');
    if (hud) {
        hud.innerHTML = `<span style="color:#f85149">WebGPU Error: ${err.message}</span>`;
    }
    if (window.__mfsEmit) {
        window.__mfsEmit(JSON.stringify({
            error: err?.message || String(err)
        }));
    }
    throw err;
});
