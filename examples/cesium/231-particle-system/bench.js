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
    renderer.setCameraAngles(0.6, 0.35);
    renderer.setCameraDistance(20.0);
    const t0 = performance.now();
    renderer.render(0.016);
    const firstFrame = performance.now() - t0;
    emit({
        metric: 'first_frame_ms',
        value: firstFrame
    });
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const bgPixel = renderer.readPixel(10, h - 10);
    const bgPass = bgPixel[0] < 40 && bgPixel[1] < 40 && bgPixel[2] < 50;
    emit({
        check: 'space-background-cleared',
        pass: bgPass,
        detail: `bg pixel RGBA=${bgPixel.join(',')}`
    });
    const groundPixel = renderer.readPixel(Math.floor(w * 0.5), Math.floor(h * 0.12));
    const groundPass = groundPixel[0] > 10 || groundPixel[1] > 15 || groundPixel[2] > 20;
    emit({
        check: 'ground-pad-rendered',
        pass: groundPass,
        detail: `ground pad pixel RGBA=${groundPixel.join(',')}`
    });
    for(let i = 0; i < 15; i++){
        renderer.render(0.03);
    }
    const firePixel = renderer.readPixel(Math.floor(w * 0.5), Math.floor(h * 0.42));
    const firePass = firePixel[0] > 60 && firePixel[1] > 30;
    emit({
        check: 'fire-plume-rendered',
        pass: firePass,
        detail: `fire plume pixel RGBA=${firePixel.join(',')}`
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
