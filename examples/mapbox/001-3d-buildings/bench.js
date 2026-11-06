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
    renderer.render(45, -17.6, 920);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const skyPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.08));
    const centerPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.52));
    const groundPx = renderer.readPixel(Math.round(w * 0.15), Math.round(h * 0.90));
    const isNightSky = skyPx[0] < 30 && skyPx[1] < 35 && skyPx[2] < 45;
    const isSkyscraper = (centerPx[0] > 25 || centerPx[1] > 35 || centerPx[2] > 50) && centerPx[3] === 255;
    emit({
        check: 'skyscrapers-3d-rendered',
        pass: isNightSky && isSkyscraper,
        detail: `center=rgba(${centerPx.join(',')}), sky=rgba(${skyPx.join(',')})`
    });
    const hasContrast = Math.abs(centerPx[2] - groundPx[2]) > 10;
    emit({
        check: 'night-lighting-contrast',
        pass: hasContrast,
        detail: `ground=rgba(${groundPx.join(',')}), skyscraper=rgba(${centerPx.join(',')})`
    });
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 30; i++){
        const bearing = -17.6 + i * 0.5;
        renderer.render(45, bearing, 920);
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
