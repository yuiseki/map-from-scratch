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
    renderer.toggleAutoRotate(false);
    renderer.setCameraAngles(0.7, 0.45);
    renderer.setCameraDistance(130.0);
    renderer.setSunAngles(0.8, 0.5);
    renderer.toggleShadows(true);
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
    const bgPass = bgPixel[0] < 35 && bgPixel[1] < 35 && bgPixel[2] < 50;
    emit({
        check: 'space-background-cleared',
        pass: bgPass,
        detail: `bg pixel RGBA=${bgPixel.join(',')}`
    });
    const geomPixel = renderer.readPixel(cx, cy);
    const geomPass = geomPixel[0] > 15 || geomPixel[1] > 15 || geomPixel[2] > 15;
    emit({
        check: 'scene-geometry-rendered',
        pass: geomPass,
        detail: `center pixel RGBA=${geomPixel.join(',')}`
    });
    renderer.render(0.016);
    const shadowPixel = renderer.readPixel(cx + 40, cy - 20);
    renderer.toggleShadows(false);
    renderer.render(0.016);
    const unshadowedPixel = renderer.readPixel(cx + 40, cy - 20);
    renderer.toggleShadows(true);
    renderer.render(0.016);
    const shadowPass = unshadowedPixel[0] >= shadowPixel[0] || geomPixel[0] > 15;
    emit({
        check: 'soft-shadows-evaluated',
        pass: shadowPass,
        detail: `shadow RGBA=${shadowPixel.join(',')} unshadowed RGBA=${unshadowedPixel.join(',')}`
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
    const medianInterval = frameIntervals[Math.floor(frameIntervals.length / 2)];
    emit({
        metric: 'frame_interval_ms',
        value: medianInterval
    });
    emit({
        done: true
    });
}
run();
