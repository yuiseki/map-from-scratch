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
    const centerPixel = renderer.readPixel(cx, cy);
    const centerHasEarth = centerPixel[0] > 5 || centerPixel[1] > 5 || centerPixel[2] > 5;
    emit({
        check: 'globe-rendered',
        pass: centerHasEarth,
        detail: `center pixel RGB(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]})`
    });
    const rimOffset = Math.floor(h * 0.35);
    const rimPixel = renderer.readPixel(cx + rimOffset, cy);
    const hasAtmosphere = rimPixel[2] > 15 && rimPixel[2] >= rimPixel[0];
    emit({
        check: 'atmosphere-halo-rendered',
        pass: hasAtmosphere,
        detail: `rim pixel RGB(${rimPixel[0]}, ${rimPixel[1]}, ${rimPixel[2]})`
    });
    const cornerPixel = renderer.readPixel(10, 10);
    const spaceClear = cornerPixel[0] < 20 && cornerPixel[1] < 25 && cornerPixel[2] < 35;
    emit({
        check: 'space-background-clear',
        pass: spaceClear,
        detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`
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
