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
    renderer.render(55, -22, 9500);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const skyPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.08));
    const centerPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.52));
    const sidePx = renderer.readPixel(Math.round(w * 0.15), Math.round(h * 0.82));
    const isSky = skyPx[0] < 30 && skyPx[1] < 35 && skyPx[2] < 45;
    const isPillar = centerPx[3] === 255 && (centerPx[0] > 40 || centerPx[1] > 40 || centerPx[2] > 40);
    emit({
        check: 'census-pillars-rendered',
        pass: isSky && isPillar,
        detail: `center=rgba(${centerPx.join(',')}), sky=rgba(${skyPx.join(',')})`
    });
    const hasDensityContrast = Math.abs(centerPx[0] - sidePx[0]) > 20 || Math.abs(centerPx[1] - sidePx[1]) > 20;
    emit({
        check: 'population-density-contrast',
        pass: hasDensityContrast,
        detail: `center=rgba(${centerPx.join(',')}), side=rgba(${sidePx.join(',')})`
    });
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 30; i++){
        const bearing = -22 + i * 0.5;
        renderer.render(55, bearing, 9500);
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
