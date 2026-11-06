import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
const BACKGROUND = [
    14,
    22,
    32
];
export async function run(io) {
    const nextFrame = ()=>new Promise((r)=>requestAnimationFrame(r));
    while(!io.ready())await nextFrame();
    const ds = io.dataset();
    io.runBinning(io.camera.radius, ds.bounds);
    const initialStats = await io.computeCellStats(io.camera.upperPercentile);
    io.draw(io.camera);
    await io.device.queue.onSubmittedWorkDone();
    emit({
        metric: 'first_frame_ms',
        value: performance.now()
    });
    emit({
        info: {
            gpu: io.gpu,
            points: ds.count,
            activeCells: initialStats.active
        }
    });
    io.freeze();
    const screen = await io.readScreen(io.camera);
    const totalPixels = screen.length / 4;
    let nonBgPixels = 0;
    for(let i = 0; i < screen.length; i += 4){
        const r = screen[i], g = screen[i + 1], b = screen[i + 2];
        const isBg = Math.abs(r - BACKGROUND[0]) <= 3 && Math.abs(g - BACKGROUND[1]) <= 3 && Math.abs(b - BACKGROUND[2]) <= 3;
        if (!isBg) nonBgPixels++;
    }
    const ratio = nonBgPixels / totalPixels;
    emit({
        check: 'screen-covered',
        pass: ratio >= 0.08,
        detail: {
            nonBgPixels,
            totalPixels,
            ratio: ratio.toFixed(3)
        }
    });
    emit({
        check: 'count-conservation',
        pass: initialStats.totalCount === ds.count,
        detail: {
            totalCount: initialStats.totalCount,
            expected: ds.count
        }
    });
    io.runBinning(800, ds.bounds);
    const stats800 = await io.computeCellStats(90);
    io.runBinning(2000, ds.bounds);
    const stats2000 = await io.computeCellStats(90);
    const adapts = stats800.active > stats2000.active && stats2000.max >= stats800.max;
    emit({
        check: 'radius-adapts',
        pass: adapts,
        detail: {
            r800: {
                active: stats800.active,
                max: stats800.max
            },
            r2000: {
                active: stats2000.active,
                max: stats2000.max
            }
        }
    });
    io.runBinning(io.camera.radius, ds.bounds);
    await io.computeCellStats(io.camera.upperPercentile);
    const cam = io.camera;
    const initialYaw = cam.yaw;
    const initialDistance = cam.distance;
    const initialPitch = cam.pitch;
    await benchFramesGpu(io.device, 300, (step)=>{
        const t = step / 300;
        cam.yaw = (initialYaw + t * 180) % 360;
        cam.distance = initialDistance * (1.0 - 0.4 * Math.sin(t * Math.PI));
        cam.pitch = initialPitch + 10 * Math.sin(t * Math.PI * 2);
        io.draw(cam, true);
    });
    const rebinTimes = [];
    for(let i = 0; i < 60; i++){
        const r = 500 + i / 59 * 2500;
        const t0 = performance.now();
        io.runBinning(r, ds.bounds);
        await io.device.queue.onSubmittedWorkDone();
        const t1 = performance.now();
        rebinTimes.push(t1 - t0);
    }
    emit({
        metric: 'rebin_ms',
        values: rebinTimes
    });
    emit({
        done: true
    });
}
