import { emit } from '../../../harness/page/bench.js';
export async function run(globe, firstFrameMs) {
    const { canvas, ctx } = globe;
    canvas.addEventListener('contextlost', ()=>emit({
            error: 'canvas context lost'
        }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    const dpr = window.devicePixelRatio || 1;
    const near = (sx, sy, ok)=>{
        const d = ctx.getImageData(Math.round(sx * dpr) - 2, Math.round(sy * dpr) - 2, 5, 5).data;
        for(let i = 0; i < d.length; i += 4)if (ok(d.subarray(i, i + 4))) return d.slice(i, i + 4);
        return d.slice(48, 52);
    };
    const pFront = globe.project(-2.1699, 35.1685);
    const pxFront = near(pFront.sx, pFront.sy, (p)=>p[1] > 140 && p[2] > 170);
    const isCyan = pxFront[1] > 140 && pxFront[2] > 170;
    emit({
        check: 'vector-borders-rendered',
        pass: pFront.visible && isCyan,
        detail: `border pos=(${Math.round(pFront.sx)}, ${Math.round(pFront.sy)}) rgba(${pxFront.join(',')}) expected cyan #06b6d4`
    });
    const pxSpace = ctx.getImageData(Math.round(20 * dpr), Math.round(20 * dpr), 1, 1).data;
    const isSpaceDark = pxSpace[0] < 15 && pxSpace[1] < 20 && pxSpace[2] < 30;
    emit({
        check: 'globe-horizon-culling',
        pass: isSpaceDark,
        detail: `space corner pos=(20, 20) rgba(${pxSpace.join(',')}) expected #030712`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        globe.rotateBy(0.015, Math.sin(i * 0.1) * 0.005);
        redrawTimes.push(performance.now() - t0);
        const now = await raf();
        frameIntervals.push(now - last);
        last = now;
    }
    emit({
        metric: 'redraw_ms',
        values: redrawTimes
    });
    emit({
        metric: 'frame_interval_ms',
        values: frameIntervals
    });
    globe.yaw = 0.35;
    globe.pitch = 0.2;
    globe.draw();
    const pRotated = globe.project(-2.1699, 35.1685);
    const pxRotated = near(pRotated.sx, pRotated.sy, (p)=>p[1] > 130 && p[2] > 160);
    const isRotatedCyan = pxRotated[1] > 130 && pxRotated[2] > 160;
    emit({
        check: 'vector-globe-rotates',
        pass: pRotated.visible && isRotatedCyan,
        detail: `rotated border pos=(${Math.round(pRotated.sx)}, ${Math.round(pRotated.sy)}) rgba(${pxRotated.join(',')})`
    });
    emit({
        done: true
    });
}
const globeInstance = window.__map;
if (globeInstance) {
    void run(globeInstance, performance.now());
}
