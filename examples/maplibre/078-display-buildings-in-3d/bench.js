import { emit, glRenderer } from '../../../harness/page/bench.js';
const renderer = window.__mfsRenderer;
export async function run() {
    const gl = renderer.gl;
    emit({
        info: {
            gpu: glRenderer(gl)
        }
    });
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webglcontextlost'
        }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const t0 = performance.now();
    renderer.render(60, -17, 950);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const skyPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.08));
    const centerPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.55));
    const groundPx = renderer.readPixel(Math.round(w * 0.2), Math.round(h * 0.88));
    const isSky = skyPx[0] > 200 && skyPx[1] > 220 && skyPx[2] > 230;
    const isBuilding = centerPx[0] > 100 && centerPx[0] < 240 && centerPx[3] === 255;
    emit({
        check: 'buildings-3d-rendered',
        pass: isBuilding && isSky,
        detail: `center=rgba(${centerPx.join(',')}), sky=rgba(${skyPx.join(',')})`
    });
    const hasContrast = Math.abs(centerPx[0] - groundPx[0]) > 5 || Math.abs(centerPx[2] - groundPx[2]) > 5;
    emit({
        check: 'depth-and-lighting-contrast',
        pass: hasContrast,
        detail: `ground=rgba(${groundPx.join(',')}), building=rgba(${centerPx.join(',')})`
    });
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 30; i++){
        const bearing = -17 + i * 0.5;
        renderer.render(60, bearing, 950);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frameIntervals.push(now - last);
        last = now;
    }
    emit({
        metric: 'frame_interval_ms',
        values: frameIntervals
    });
    emit({
        done: true
    });
}
run();
