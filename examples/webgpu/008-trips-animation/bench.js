import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
const BACKGROUND = [
    9,
    14,
    20
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
            renderer: 'WebGPU Trips & Buildings'
        }
    });
    io.freeze();
    const screen500 = await io.readScreen(io.camera);
    let buildingPixels = 0;
    let yellowPixels = 0;
    let greenPixels = 0;
    for(let i = 0; i < screen500.length; i += 4){
        const r = screen500[i], g = screen500[i + 1], b = screen500[i + 2];
        const isBg = Math.abs(r - BACKGROUND[0]) <= 3 && Math.abs(g - BACKGROUND[1]) <= 3 && Math.abs(b - BACKGROUND[2]) <= 3;
        if (!isBg) {
            if (b > r && g > r && r < 120 && b < 160) {
                buildingPixels++;
            }
            if (r > 150 && g > 100 && b < 80) {
                yellowPixels++;
            }
            if (g > 140 && b > 80 && r < 90) {
                greenPixels++;
            }
        }
    }
    emit({
        check: 'buildings-rendered',
        pass: buildingPixels >= 8000,
        detail: {
            buildingPixels
        }
    });
    emit({
        check: 'trips-visible',
        pass: yellowPixels >= 30 && greenPixels >= 30,
        detail: {
            yellowPixels,
            greenPixels
        }
    });
    const prevTime = io.camera.time;
    io.camera.time = 1500;
    const screen1500 = await io.readScreen(io.camera);
    io.camera.time = prevTime;
    let diffCount = 0;
    for(let i = 0; i < screen500.length; i += 4){
        const dr = Math.abs(screen500[i] - screen1500[i]);
        const dg = Math.abs(screen500[i + 1] - screen1500[i + 1]);
        const db = Math.abs(screen500[i + 2] - screen1500[i + 2]);
        if (dr + dg + db > 25) diffCount++;
    }
    const diffRatio = diffCount / (screen500.length / 4);
    emit({
        check: 'time-advances-trails',
        pass: diffRatio >= 0.003,
        detail: {
            diffPixels: diffCount,
            diffRatio: diffRatio.toFixed(4)
        }
    });
    const cam = io.camera;
    const initBearing = cam.bearing;
    const initZoom = cam.zoom;
    const initPitch = cam.pitch;
    await benchFramesGpu(io.device, 300, (step)=>{
        const t = step / 300;
        cam.bearing = (initBearing + t * 90) % 360;
        cam.time = (900 + t * 400) % 1800;
        cam.pitch = initPitch + 8 * Math.sin(t * Math.PI * 2);
        cam.zoom = initZoom + 0.3 * Math.sin(t * Math.PI);
        io.draw(cam, true);
    });
    emit({
        done: true
    });
}
