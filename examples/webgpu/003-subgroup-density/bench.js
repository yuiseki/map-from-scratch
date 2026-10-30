import { emit } from '../../../harness/page/bench.js';
export async function runBench(map, firstFrameMs) {
    const { canvas } = map;
    await new Promise(requestAnimationFrame);
    emit({
        info: {
            gpu: map.gpu
        }
    });
    emit({
        metric: 'first_frame_ms',
        value: firstFrameMs
    });
    emit({
        check: 'points-loaded',
        pass: map.pointCount === 1048576,
        detail: `pointCount = ${map.pointCount} (1,048,576 nodes)`
    });
    emit({
        check: 'subgroups-enabled',
        pass: map.hasSubgroups,
        detail: `hasSubgroups = ${map.hasSubgroups}`
    });
    const initialPeak = await map.getMaxDensity();
    emit({
        check: 'density-grid-populated',
        pass: initialPeak >= 20,
        detail: `peakDensity = ${initialPeak} / cell`
    });
    const ab = await (await fetch('../../../data/baked/webgpu-003-subgroup-density/points.bin')).arrayBuffer();
    const q = new Uint16Array(ab, 40, map.pointCount * 2);
    const cpuPeak = ()=>{
        const [x0, y0, x1, y1, gw, gh] = map.view();
        const f = Math.fround;
        const cells = new Uint32Array(gw * gh);
        let inView = 0, peak = 0;
        for(let i = 0; i < map.pointCount; i++){
            const px = f(q[i * 2] / 65535), py = f(q[i * 2 + 1] / 65535);
            if (px < f(x0) || px > f(x1) || py < f(y0) || py > f(y1)) continue;
            const cxi = Math.min(gw - 1, Math.max(0, Math.floor(f(f(f(px - f(x0)) / f(f(x1) - f(x0))) * gw))));
            const cyi = Math.min(gh - 1, Math.max(0, Math.floor(f(f(f(py - f(y0)) / f(f(y1) - f(y0))) * gh))));
            const c = ++cells[cyi * gw + cxi];
            if (c > peak) peak = c;
            inView++;
        }
        return `${peak} over ${inView} points in a ${gw}x${gh} grid`;
    };
    const cpu0 = cpuPeak();
    emit({
        check: 'gpu-peak-matches-cpu',
        pass: cpu0.startsWith(`${initialPeak} `),
        detail: `GPU peak ${initialPeak}, CPU peak ${cpu0} (subgroups ${map.hasSubgroups})`
    });
    const centerPx = await map.readPixel(Math.round(canvas.width / 2), Math.round(canvas.height / 2));
    const isBackground = centerPx[0] <= 15 && centerPx[1] <= 15 && centerPx[2] <= 25;
    emit({
        check: 'heatmap-pixels-rendered',
        pass: !isBackground,
        detail: `center pixel = rgba(${Array.from(centerPx).join(',')}) (Turbo)`
    });
    map.zoomBy(1.5);
    const zoomedPeak = await map.getMaxDensity();
    map.panBy(400, 400);
    const pannedPeak = await map.getMaxDensity();
    const cpu1 = cpuPeak();
    emit({
        check: 'pan-updates-density',
        pass: cpu1.startsWith(`${pannedPeak} `),
        detail: `peakDensity zoomed = ${zoomedPeak}, after pan GPU ${pannedPeak}, CPU ${cpu1}`
    });
    const frameTimes = [];
    const redrawTimes = [];
    let lastTimestamp = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.panBy(Math.sin(i * 0.1) * 5, Math.cos(i * 0.1) * 5);
        const redrawMs = performance.now() - t0;
        redrawTimes.push(redrawMs);
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frameTimes.push(now - lastTimestamp);
        lastTimestamp = now;
    }
    for (const r of redrawTimes)emit({
        metric: 'redraw_ms',
        value: r
    });
    for (const f of frameTimes)emit({
        metric: 'frame_interval_ms',
        value: f
    });
    emit({
        done: true
    });
}
