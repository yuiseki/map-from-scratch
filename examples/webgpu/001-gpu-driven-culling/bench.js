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
        check: 'buildings-loaded',
        pass: map.buildingCount === 3992,
        detail: `total building count = ${map.buildingCount}`
    });
    const base = '../../../data/baked';
    const ab = await (await fetch(`${base}/webgpu-001-gpu-driven-culling/buildings.bin`)).arrayBuffer();
    const q = new Int16Array(ab, 32, map.buildingCount * 4);
    const inst = Float32Array.from(q, (v)=>v / 10);
    const truth = await (await fetch(`${base}/16-plateau-buildings-3d/truth.json`)).json();
    let top = 0, areaSum = 0;
    for(let i = 0; i < map.buildingCount; i++){
        if (inst[i * 4 + 2] > inst[top * 4 + 2]) top = i;
        areaSum += inst[i * 4 + 3] ** 2;
    }
    const truthArea = truth.points.reduce((s, p)=>s + p[2], 0);
    const dist = Math.hypot(inst[top * 4] - truth.tallest.x, inst[top * 4 + 1] - truth.tallest.y);
    const h = inst[top * 4 + 2];
    emit({
        check: 'heights-from-plateau',
        pass: dist < 60 && h > truth.tallest.maxz - 15 && h <= truth.tallest.maxz && Math.abs(areaSum / truthArea - 1) < 0.01,
        detail: `tallest instance ${h.toFixed(1)} m, ${dist.toFixed(0)} m from 16's tallest (maxz ${truth.tallest.maxz} m); footprints ${Math.round(areaSum)} / ${truthArea} m2`
    });
    const visibleCount = await map.getVisibleCount();
    const cullingPass = visibleCount > 0 && visibleCount < map.buildingCount;
    emit({
        check: 'gpu-compute-culling',
        pass: cullingPass,
        detail: `GPU visible count = ${visibleCount} / ${map.buildingCount} (${(visibleCount / map.buildingCount * 100).toFixed(1)}% in frustum)`
    });
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const centerPx = await map.readPixel(cx, cy);
    const isRendered = centerPx[0] > 30 || centerPx[1] > 30 || centerPx[2] > 30;
    emit({
        check: 'buildings-rendered',
        pass: isRendered,
        detail: `rgba(${Array.from(centerPx).join(',')}) at screen center (${cx}, ${cy})`
    });
    const countBefore = visibleCount;
    map.orbitBy(0.8, 0.2);
    const countAfter = await map.getVisibleCount();
    const orbitPass = countAfter !== countBefore && countAfter > 0;
    emit({
        check: 'camera-orbit-updates-count',
        pass: orbitPass,
        detail: `visible count changed on camera rotation: before=${countBefore}, after=${countAfter}`
    });
    const raf = ()=>new Promise(requestAnimationFrame);
    await raf();
    const redrawTimes = [];
    const frameIntervals = [];
    let last = performance.now();
    for(let i = 0; i < 60; i++){
        const t0 = performance.now();
        map.orbitBy(0.015, 0.003 * Math.sin(i * 0.1));
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
