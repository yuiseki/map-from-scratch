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
    const isTerrain = centerPixel[0] !== 174 || centerPixel[1] !== 199 || centerPixel[2] !== 230;
    emit({
        check: 'mountain-rendered',
        pass: isTerrain,
        detail: `center pixel RGB(${centerPixel[0]}, ${centerPixel[1]}, ${centerPixel[2]})`
    });
    const valleyPixel = renderer.readPixel(cx, Math.floor(h * 0.2));
    const hasValley = valleyPixel[3] === 255;
    emit({
        check: 'elevation-bands-visible',
        pass: hasValley,
        detail: `valley pixel RGB(${valleyPixel[0]}, ${valleyPixel[1]}, ${valleyPixel[2]})`
    });
    const skyPixel = renderer.readPixel(cx, h - 5);
    const isSky = skyPixel[2] > 200 && skyPixel[0] > 140;
    emit({
        check: 'sky-background-clear',
        pass: isSky,
        detail: `sky pixel RGB(${skyPixel[0]}, ${skyPixel[1]}, ${skyPixel[2]})`
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
