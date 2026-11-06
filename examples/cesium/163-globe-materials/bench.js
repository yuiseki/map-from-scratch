import { emit, glRenderer } from '../../../harness/page/bench.js';
const renderer = window.__mfsRenderer;
export async function run() {
    const gl = renderer.gl;
    gl.canvas.addEventListener('webglcontextlost', ()=>emit({
            error: 'webglcontextlost'
        }));
    emit({
        info: {
            gpu: glRenderer(gl)
        }
    });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    renderer.setCameraAngles(0.5, 0.3);
    renderer.setCameraDistance(160.0);
    const t0 = performance.now();
    renderer.render(0.016);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const bgPixel = renderer.readPixel(10, h - 10);
    const bgPass = bgPixel[0] < 30 && bgPixel[1] < 30 && bgPixel[2] < 45;
    emit({
        check: 'space-background-cleared',
        pass: bgPass,
        detail: `bg pixel RGBA=${bgPixel.join(',')}`
    });
    const centerPixel = renderer.readPixel(cx, cy);
    const centerPass = centerPixel[0] > 15 || centerPixel[1] > 20 || centerPixel[2] > 25;
    emit({
        check: 'globe-materials-rendered',
        pass: centerPass,
        detail: `center globe pixel RGBA=${centerPixel.join(',')}`
    });
    for(let i = 0; i < 20; i++){
        renderer.render(0.03);
    }
    const midPixel = renderer.readPixel(cx + Math.floor(w * 0.1), cy);
    const midPass = midPixel[0] > 10 || midPixel[1] > 20 || midPixel[2] > 20;
    emit({
        check: 'radar-sweep-active',
        pass: midPass,
        detail: `mid globe pixel RGBA=${midPixel.join(',')}`
    });
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 15; i++){
        renderer.render(0.016);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frameIntervals.push(now - last);
        last = now;
    }
    frameIntervals.sort((a, b)=>a - b);
    const p95 = frameIntervals[Math.floor(frameIntervals.length * 0.95)];
    emit({
        metric: 'frame_interval_ms',
        value: p95
    });
    emit({
        done: true
    });
}
run();
