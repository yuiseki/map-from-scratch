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
    const pLondon = globe.project(-0.1278, 51.5074);
    const pxLondon = ctx.getImageData(Math.round(pLondon.sx * dpr), Math.round(pLondon.sy * dpr), 1, 1).data;
    const isYellow = pxLondon[0] > 200 && pxLondon[1] > 170 && pxLondon[2] < 60;
    emit({
        check: 'front-points-rendered',
        pass: pLondon.visible && isYellow,
        detail: `london front pt (${Math.round(pLondon.sx)}, ${Math.round(pLondon.sy)}) rgba(${pxLondon.join(',')}) expected yellow #facc15`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        globe.rotateBy(0.02, Math.sin(i * 0.1) * 0.005);
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
    globe.yaw = Math.PI;
    globe.pitch = 0.35;
    globe.draw();
    const pLondonBack = globe.project(-0.1278, 51.5074);
    const pxLondonBack = ctx.getImageData(Math.round(pLondon.sx * dpr), Math.round(pLondon.sy * dpr), 1, 1).data;
    const isNotYellow = pxLondonBack[0] < 150 || pxLondonBack[1] < 150;
    emit({
        check: 'backside-points-occluded',
        pass: !pLondonBack.visible && isNotYellow,
        detail: `london rotated to back (visible=${pLondonBack.visible}) rgba(${pxLondonBack.join(',')})`
    });
    globe.yaw = 0.4;
    globe.pitch = 0.2;
    globe.draw();
    const pRotated = globe.project(-0.1278, 51.5074);
    const pxRotated = ctx.getImageData(Math.round(pRotated.sx * dpr), Math.round(pRotated.sy * dpr), 1, 1).data;
    const isRotatedYellow = pxRotated[0] > 180 && pxRotated[1] > 160 && pxRotated[2] < 70;
    emit({
        check: 'points-rotate-with-drag',
        pass: pRotated.visible && isRotatedYellow,
        detail: `london rotated pos (${Math.round(pRotated.sx)}, ${Math.round(pRotated.sy)}) rgba(${pxRotated.join(',')})`
    });
    emit({
        done: true
    });
}
const globeInstance = window.__map;
if (globeInstance) {
    void run(globeInstance, performance.now());
}
