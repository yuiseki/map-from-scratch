export const emit = (o)=>window.__mfsEmit ? window.__mfsEmit(JSON.stringify(o)) : console.log('@mfs ' + JSON.stringify(o));
export function glRenderer(gl) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}
const nextFrame = ()=>new Promise((r)=>requestAnimationFrame(r));
export async function benchFrames(gl, steps, drawStep, { warmup = 10, prefix = '' } = {}) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const px = new Uint8Array(4);
    const cpu = [], frame = [], queries = [];
    for(let i = -warmup; i < steps; i++){
        const k = (i % steps + steps) % steps;
        const q = ext && i >= 0 ? gl.createQuery() : null;
        const t0 = performance.now();
        if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        drawStep(k);
        if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        if (i < 0) continue;
        cpu.push(t1 - t0);
        frame.push(t2 - t0);
        if (q) queries.push(q);
    }
    emit({
        metric: `${prefix}cpu_ms`,
        values: cpu
    });
    emit({
        metric: `${prefix}frame_ms`,
        values: frame
    });
    if (!ext) return;
    const gpu = [];
    for (const q of queries){
        while(!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))await nextFrame();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
    }
    emit({
        metric: `${prefix}gpu_ms`,
        values: gpu
    });
}
export function zoomPath(steps, { cx, cy, z0, z1, pan = 0 }) {
    return Array.from({
        length: steps
    }, (_, i)=>{
        const u = i / (steps - 1);
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
        return {
            cx: cx + pan * Math.sin(2 * Math.PI * u),
            cy: cy + pan * 0.5 * Math.sin(4 * Math.PI * u),
            zoom: z0 + (z1 - z0) * w
        };
    });
}
