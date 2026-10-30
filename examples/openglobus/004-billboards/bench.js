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
export async function run(map, firstFrameMs) {
    const { canvas, ctx } = map;
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
    const cairoPos = map.getScreenCoords(31.2357, 30.0444);
    const cairoCheck = findColorNear(ctx, cairoPos.x, cairoPos.y, 11, dpr, (r, g, b)=>r > 200 && g < 60 && b > 80);
    emit({
        check: 'billboards-rendered',
        pass: cairoCheck.found,
        detail: `Cairo billboard found=${cairoCheck.found} (${cairoCheck.color.join(',')})`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.panBy(Math.sin(i * 0.1) * 2, Math.cos(i * 0.1) * 2);
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
    map.setZoom(2);
    map.center = {
        lon: 31.2357,
        lat: 30.0444
    };
    map.draw();
    const basePos = map.getScreenCoords(31.2357, 30.0444);
    map.panBy(50, 30);
    const panPos = map.getScreenCoords(31.2357, 30.0444);
    const panCheck = findColorNear(ctx, panPos.x, panPos.y, 11, dpr, (r, g, b)=>r > 200 && g < 60 && b > 80);
    emit({
        check: 'billboards-move-with-pan',
        pass: panCheck.found && Math.round(panPos.x - basePos.x) === 50 && Math.round(panPos.y - basePos.y) === 30,
        detail: `dx=${Math.round(panPos.x - basePos.x)}, dy=${Math.round(panPos.y - basePos.y)}, found=${panCheck.found}`
    });
    map.setZoom(3);
    const zoomPos = map.getScreenCoords(31.2357, 30.0444);
    const zoomCheck = findColorNear(ctx, zoomPos.x, zoomPos.y, 12, dpr, (r, g, b)=>r > 200 && g < 60 && b > 80);
    emit({
        check: 'billboards-anchor-on-zoom',
        pass: zoomCheck.found,
        detail: `zoom=3 pos=(${Math.round(zoomPos.x)}, ${Math.round(zoomPos.y)}), found=${zoomCheck.found}`
    });
    emit({
        done: true
    });
}
