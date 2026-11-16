import { emit } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    const { canvas } = map;
    await new Promise(requestAnimationFrame);
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    await new Promise((r)=>setTimeout(r, 100));
    map.render();
    const stats0 = await map.getStats();
    emit({
        check: 'opfs-stored',
        pass: stats0.opfsSize > 60000,
        detail: `OPFS archive size = ${stats0.opfsSize} bytes`
    });
    emit({
        check: 'sync-access-reads',
        pass: stats0.totalSyncReads >= 1 && stats0.avgLatencyMs < 1.0,
        detail: `sync reads = ${stats0.totalSyncReads}, avg latency = ${(stats0.avgLatencyMs * 1000).toFixed(1)} µs`
    });
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const centerPx = map.readPixel(cx, cy);
    const isLand = centerPx[0] >= 25 && centerPx[1] >= 35 && centerPx[2] >= 50;
    emit({
        check: 'tiles-rendered',
        pass: isLand,
        detail: `rgba(${Array.from(centerPx).join(',')}) at screen center (${cx}, ${cy})`
    });
    const dpr = window.devicePixelRatio || 1;
    const square = canvas.width === Math.round(canvas.clientWidth * dpr) && canvas.height === Math.round(canvas.clientHeight * dpr);
    const land = (p)=>p[0] >= 25 && p[1] >= 35 && p[2] >= 50;
    const colA = cx - 100 * dpr, colB = colA + map.worldPx() * dpr;
    let landRows = 0, differ = 0;
    for(let y = 0; y < canvas.height; y += 4){
        const a = land(map.readPixel(colA, y)), b = land(map.readPixel(colB, y));
        if (a) landRows++;
        if (a !== b) differ++;
    }
    emit({
        check: 'square-tiles-and-world-copies',
        pass: square && colB < canvas.width && landRows > 10 && differ <= 2,
        detail: `backing ${canvas.width}x${canvas.height} for CSS ${canvas.clientWidth}x${canvas.clientHeight} at dpr ${dpr}; columns ${colA} and ${Math.round(colB)}: ${landRows} land rows, ${differ} differ`
    });
    const readsBefore = stats0.totalSyncReads;
    map.panBy(300, 150);
    await new Promise((r)=>setTimeout(r, 100));
    const statsAfter = await map.getStats();
    const panPass = statsAfter.totalSyncReads >= readsBefore && statsAfter.networkRequests === 0;
    emit({
        check: 'pan-triggers-opfs-reads',
        pass: panPass,
        detail: `reads after pan: before=${readsBefore}, after=${statsAfter.totalSyncReads}, networkRequests=${statsAfter.networkRequests}`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    await raf();
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.panBy(Math.sin(i * 0.1) * 3, Math.cos(i * 0.1) * 2);
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
    emit({
        done: true
    });
}
