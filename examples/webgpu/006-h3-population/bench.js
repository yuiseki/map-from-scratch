import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
const BACKGROUND = [
    14,
    22,
    32
];
export async function run(io) {
    const nextFrame = ()=>new Promise((r)=>requestAnimationFrame(r));
    while(!io.ready())await nextFrame();
    io.draw(io.camera);
    await io.device.queue.onSubmittedWorkDone();
    emit({
        metric: 'first_frame_ms',
        value: performance.now()
    });
    emit({
        info: {
            gpu: io.gpu,
            renderer: 'WebGPU 3D Extruded H3 Columns'
        }
    });
    io.freeze();
    const screen = await io.readScreen(io.camera);
    const totalPixels = screen.length / 4;
    let nonBgPixels = 0;
    const colorBuckets = new Set();
    for(let i = 0; i < screen.length; i += 4){
        const r = screen[i], g = screen[i + 1], b = screen[i + 2];
        const isBg = Math.abs(r - BACKGROUND[0]) <= 3 && Math.abs(g - BACKGROUND[1]) <= 3 && Math.abs(b - BACKGROUND[2]) <= 3;
        if (!isBg) {
            nonBgPixels++;
            const key = `${Math.floor(r / 32)},${Math.floor(g / 32)},${Math.floor(b / 32)}`;
            colorBuckets.add(key);
        }
    }
    const coverageRatio = nonBgPixels / totalPixels;
    emit({
        check: 'screen-covered',
        pass: coverageRatio >= 0.18,
        detail: {
            nonBgPixels,
            totalPixels,
            coverageRatio: coverageRatio.toFixed(3)
        }
    });
    emit({
        check: 'cells-rendered',
        pass: colorBuckets.size >= 4,
        detail: {
            uniqueColorBuckets: colorBuckets.size
        }
    });
    const tokyoLon = 139.767, tokyoLat = 35.681;
    const sin = Math.sin(tokyoLat * Math.PI / 180);
    const mx = (tokyoLon + 180) / 360 * 65535;
    const my = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 65535;
    let tokyoCell = null;
    for (const c of io.cells()){
        const [l, t, r, b] = c.box;
        if (mx < l || mx > r || my < t || my > b) continue;
        for (const ring of c.rings){
            let inside = false;
            for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
                const p1 = ring[i], p2 = ring[j];
                if (p1[1] > my !== p2[1] > my && mx < (p2[0] - p1[0]) * (my - p1[1]) / (p2[1] - p1[1]) + p1[0]) {
                    inside = !inside;
                }
            }
            if (inside) {
                tokyoCell = c;
                break;
            }
        }
        if (tokyoCell) break;
    }
    const tokyoPass = !!tokyoCell && tokyoCell.population >= 1000000;
    emit({
        check: 'hover-picking',
        pass: tokyoPass,
        detail: tokyoCell ? {
            h3: tokyoCell.h3,
            population: tokyoCell.population
        } : 'not found'
    });
    const cam = io.camera;
    const initialYaw = cam.yaw;
    const initialDistance = cam.distance;
    const initialPitch = cam.pitch;
    await benchFramesGpu(io.device, 300, (step)=>{
        const t = step / 300;
        cam.yaw = (initialYaw + t * 180) % 360;
        cam.distance = initialDistance * (1.0 - 0.5 * Math.sin(t * Math.PI));
        cam.pitch = initialPitch + 15 * Math.sin(t * Math.PI * 2);
        io.draw(cam, true);
    });
    emit({
        done: true
    });
}
