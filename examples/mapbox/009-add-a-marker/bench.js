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
    const p1 = map.getScreenCoords(12.554729, 55.70651);
    const m1Check = findColorNear(ctx, p1.x, p1.y - 28, 8, dpr, (r, g, b)=>r < 100 && g > 140 && b > 170);
    const p2 = map.getScreenCoords(12.65147, 55.608166);
    const m2Check = findColorNear(ctx, p2.x + 20, p2.y - 20, 8, dpr, (r, g, b)=>r < 50 && g < 50 && b < 50);
    emit({
        check: 'markers-rendered',
        pass: m1Check.found && m2Check.found,
        detail: `m1 cyan found=${m1Check.found} (${m1Check.color.join(',')}), m2 black found=${m2Check.found} (${m2Check.color.join(',')})`
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
    map.setZoom(8);
    map.center = {
        lon: 12.550343,
        lat: 55.665957
    };
    map.draw();
    const baseP1 = map.getScreenCoords(12.554729, 55.70651);
    map.panBy(40, 25);
    const panP1 = map.getScreenCoords(12.554729, 55.70651);
    const panCheck = findColorNear(ctx, panP1.x, panP1.y - 28, 8, dpr, (r, g, b)=>r < 100 && g > 140 && b > 170);
    emit({
        check: 'markers-move-with-pan',
        pass: panCheck.found && Math.round(panP1.x - baseP1.x) === 40 && Math.round(panP1.y - baseP1.y) === 25,
        detail: `dx=${Math.round(panP1.x - baseP1.x)}, dy=${Math.round(panP1.y - baseP1.y)}, found=${panCheck.found}`
    });
    map.setZoom(9);
    const zoomP1 = map.getScreenCoords(12.554729, 55.70651);
    const zoomCheck = findColorNear(ctx, zoomP1.x, zoomP1.y - 28, 8, dpr, (r, g, b)=>r < 100 && g > 140 && b > 170);
    emit({
        check: 'markers-anchor-on-zoom',
        pass: zoomCheck.found,
        detail: `zoom=9 pos=(${Math.round(zoomP1.x)}, ${Math.round(zoomP1.y)}), found=${zoomCheck.found}`
    });
    emit({
        done: true
    });
}
