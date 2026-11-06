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
    renderer.state.autoRotate = false;
    renderer.state.yaw = 0.6;
    renderer.state.pitch = 0.35;
    renderer.state.distance = 850;
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
    const cornerPixel = renderer.readPixel(10, h - 10);
    const isDark = cornerPixel[0] <= 15 && cornerPixel[1] <= 15 && cornerPixel[2] <= 25;
    emit({
        check: 'space-background-cleared',
        pass: isDark,
        detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`
    });
    const centerPixel = renderer.readPixel(cx, cy);
    const isPlanet = centerPixel[3] === 255 && centerPixel[2] > 20;
    emit({
        check: 'central-globe-rendered',
        pass: isPlanet,
        detail: `center pixel RGB(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]})`
    });
    for(let i = 0; i < 10; i++){
        renderer.render(0.03);
    }
    emit({
        check: 'particle-tails-rendered',
        pass: renderer.getTotalParticles() > 50,
        detail: `total tail particles: ${renderer.getTotalParticles()}`
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
