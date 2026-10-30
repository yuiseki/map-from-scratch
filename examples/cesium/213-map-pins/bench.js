import { emit } from '../../../harness/page/bench.js';
function findColorNear(ctx, cx, cy, radius, dpr, predicate) {
    const size = radius * 2 + 1;
    const sx = Math.max(0, Math.round((cx - radius) * dpr));
    const sy = Math.max(0, Math.round((cy - radius) * dpr));
    const img = ctx.getImageData(sx, sy, Math.round(size * dpr), Math.round(size * dpr));
    const data = img.data;
    for(let i = 0; i < data.length; i += 4){
        if (predicate(data[i], data[i + 1], data[i + 2])) {
            return {
                found: true,
                color: [
                    data[i],
                    data[i + 1],
                    data[i + 2],
                    data[i + 3]
                ]
            };
        }
    }
    return {
        found: false,
        color: [
            data[0],
            data[1],
            data[2],
            data[3]
        ]
    };
}
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
    globe.yaw = 0.0;
    globe.pitch = 0.3;
    globe.zoomScale = 1.0;
    globe.draw();
    const londonProj = globe.projectPoint(-0.1276, 51.5074);
    const tokyoProj0 = globe.projectPoint(139.6917, 35.6895);
    const londonCheck = findColorNear(ctx, londonProj.x, londonProj.y - 22, 8, dpr, (r, g, b)=>r < 100 && g > 140 && b < 100);
    emit({
        check: 'pins-rendered-on-front-hemisphere',
        pass: londonProj.visible && londonCheck.found && !tokyoProj0.visible,
        detail: `London visible=${londonProj.visible} found=${londonCheck.found}, Tokyo visible=${tokyoProj0.visible}`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        globe.rotateBy(0.03, Math.sin(i * 0.1) * 0.01);
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
    globe.yaw = 2.4;
    globe.pitch = 0.3;
    globe.zoomScale = 1.0;
    globe.draw();
    const tokyoProj1 = globe.projectPoint(139.6917, 35.6895);
    const londonProj1 = globe.projectPoint(-0.1276, 51.5074);
    const tokyoCheck = findColorNear(ctx, tokyoProj1.x, tokyoProj1.y - 22, 8, dpr, (r, g, b)=>r > 180 && g < 100 && b < 100);
    emit({
        check: 'pins-occlude-when-rotated',
        pass: tokyoProj1.visible && tokyoCheck.found && !londonProj1.visible,
        detail: `Tokyo visible=${tokyoProj1.visible} found=${tokyoCheck.found}, London visible=${londonProj1.visible}`
    });
    globe.zoomScale = 1.4;
    globe.draw();
    const tokyoProjZoom = globe.projectPoint(139.6917, 35.6895);
    const zoomCheck = findColorNear(ctx, tokyoProjZoom.x, tokyoProjZoom.y - 22, 10, dpr, (r, g, b)=>r > 180 && g < 100 && b < 100);
    emit({
        check: 'pins-scale-with-zoom',
        pass: zoomCheck.found,
        detail: `zoom pos=(${Math.round(tokyoProjZoom.x)}, ${Math.round(tokyoProjZoom.y)}), found=${zoomCheck.found}`
    });
    emit({
        done: true
    });
}
