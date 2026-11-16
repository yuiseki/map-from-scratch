import { WebGPUHeatmapRenderer } from './render.js';
async function init() {
    const canvas = document.getElementById('canvas');
    const statusEl = document.getElementById('status');
    const radiusInput = document.getElementById('radius');
    const intensityInput = document.getElementById('intensity');
    const thresholdInput = document.getElementById('threshold');
    const countEl = document.getElementById('point-count');
    if (!navigator.gpu) {
        statusEl.textContent = 'WebGPU is not supported in this browser.';
        return;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        statusEl.textContent = 'No suitable WebGPU adapter found.';
        return;
    }
    const device = await adapter.requestDevice();
    const gpu = `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim();
    const context = canvas.getContext('webgpu');
    if (!context) {
        statusEl.textContent = 'Failed to get WebGPU context.';
        return;
    }
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', ()=>{
        resize();
        render();
    });
    resize();
    const renderer = new WebGPUHeatmapRenderer(device, context);
    const view = {
        center: [
            -73.985,
            40.748
        ],
        zoom: 11.5,
        radius: parseFloat(radiusInput.value) || 30,
        intensity: parseFloat(intensityInput.value) || 1.0,
        threshold: parseFloat(thresholdInput.value) || 0.05,
        width: canvas.width,
        height: canvas.height
    };
    function render() {
        view.width = canvas.width;
        view.height = canvas.height;
        renderer.render(view);
    }
    statusEl.textContent = 'Loading NYC Uber pickup points...';
    try {
        const res = await fetch('../../../data/baked/deckgl-011-heatmap-layer/points.bin');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bin = await res.arrayBuffer();
        renderer.setData(bin);
        countEl.textContent = '100,000 points';
        statusEl.textContent = 'Ready';
    } catch (err) {
        statusEl.textContent = `Failed to load points: ${err instanceof Error ? err.message : String(err)}`;
        return;
    }
    radiusInput.addEventListener('input', ()=>{
        view.radius = parseFloat(radiusInput.value);
        render();
    });
    intensityInput.addEventListener('input', ()=>{
        view.intensity = parseFloat(intensityInput.value);
        render();
    });
    thresholdInput.addEventListener('input', ()=>{
        view.threshold = parseFloat(thresholdInput.value);
        render();
    });
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e)=>{
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        const scale = 256 * Math.pow(2, view.zoom);
        view.center[0] -= dx / scale * 360;
        view.center[1] += dy / scale * 180;
        render();
    });
    const stopDrag = (e)=>{
        if (isDragging) {
            isDragging = false;
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const zoomFactor = Math.exp(-e.deltaY * 0.002);
        view.zoom = Math.max(8, Math.min(18, view.zoom + Math.log2(zoomFactor)));
        render();
    }, {
        passive: false
    });
    render();
    if (window.location.search.includes('bench')) {
        import('./bench.js').then((mod)=>{
            mod.run({
                device,
                gpu,
                renderer,
                view,
                ready: ()=>renderer.hasData()
            });
        });
    }
}
init();
