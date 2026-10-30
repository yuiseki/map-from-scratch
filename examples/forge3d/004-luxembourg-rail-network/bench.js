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
    const luxStation = map.data.stations.find((s)=>s.name === 'Luxembourg');
    if (!luxStation) throw new Error('Luxembourg station not found in baked data');
    const p0 = map.getScreenCoords(luxStation.pos[0], luxStation.pos[1]);
    const railCheck = findColorNear(ctx, p0.x, p0.y, 6, dpr, (r, g, b)=>r > 180 && g > 60 && b < 100);
    emit({
        check: 'rail-network-rendered',
        pass: railCheck.found,
        detail: `Luxembourg station node found=${railCheck.found} (${railCheck.color.join(',')})`
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
    map.setZoom(10);
    map.center = {
        lon: 6.13,
        lat: 49.80
    };
    map.draw();
    const baseP = map.getScreenCoords(luxStation.pos[0], luxStation.pos[1]);
    map.panBy(40, 25);
    const panP = map.getScreenCoords(luxStation.pos[0], luxStation.pos[1]);
    const panCheck = findColorNear(ctx, panP.x, panP.y, 6, dpr, (r, g, b)=>r > 180 && g > 60 && b < 100);
    emit({
        check: 'vector-overlay-moves-with-pan',
        pass: panCheck.found && Math.round(panP.x - baseP.x) === 40 && Math.round(panP.y - baseP.y) === 25,
        detail: `dx=${Math.round(panP.x - baseP.x)}, dy=${Math.round(panP.y - baseP.y)}, found=${panCheck.found}`
    });
    map.center = {
        lon: 6.133,
        lat: 49.600
    };
    map.setZoom(11);
    const zoomP = map.getScreenCoords(luxStation.pos[0], luxStation.pos[1]);
    const zoomCheck = findColorNear(ctx, zoomP.x, zoomP.y, 8, dpr, (r, g, b)=>r > 180 && g > 60 && b < 100);
    emit({
        check: 'vector-overlay-anchors-on-zoom',
        pass: zoomCheck.found,
        detail: `zoom=11 pos=(${Math.round(zoomP.x)}, ${Math.round(zoomP.y)}), found=${zoomCheck.found}`
    });
    emit({
        done: true
    });
}
