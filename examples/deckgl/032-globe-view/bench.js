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
    renderer.render(35, 22, 2.85);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const spacePx = renderer.readPixel(Math.round(w * 0.05), Math.round(h * 0.05));
    const globePx = renderer.readPixel(Math.round(w / 2), Math.round(h / 2));
    const limbPx = renderer.readPixel(Math.round(w * 0.68), Math.round(h * 0.42));
    const isSpace = spacePx[0] < 15 && spacePx[1] < 15 && spacePx[2] < 20;
    const isGlobe = globePx[3] === 255 && (globePx[0] > 15 || globePx[1] > 30 || globePx[2] > 40);
    emit({
        check: 'globe-rendered-in-space',
        pass: isSpace && isGlobe,
        detail: `globe=rgba(${globePx.join(',')}), space=rgba(${spacePx.join(',')})`
    });
    const hasGlow = limbPx[2] > 40 && limbPx[3] === 255;
    emit({
        check: 'atmosphere-and-arcs-detected',
        pass: hasGlow,
        detail: `limb=rgba(${limbPx.join(',')})`
    });
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 30; i++){
        const yaw = 35 + i * 0.8;
        renderer.render(yaw, 22, 2.85);
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
