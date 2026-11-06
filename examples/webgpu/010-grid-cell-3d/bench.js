import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
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
            renderer: 'WebGPU 3D GridCellLayer'
        }
    });
    io.freeze();
    const pixels = await io.readScreen(io.camera);
    const [w, h] = [
        io.camera.width || 1280,
        io.camera.height || 800
    ];
    let gridPixelCount = 0;
    for(let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++){
        for(let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++){
            const idx = (y * w + x) * 4;
            const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
            if (g > 60 && (r > 30 || b > 30)) {
                gridPixelCount++;
            }
        }
    }
    const pass = gridPixelCount > 50;
    emit({
        check: 'check-rendered-grid',
        pass,
        detail: {
            detectedGridPixels: gridPixelCount
        }
    });
    const cam = io.camera;
    const initialYaw = cam.yaw;
    await benchFramesGpu(io.device, 180, (step)=>{
        cam.yaw = (initialYaw + step * 0.5) % 360;
        io.draw(cam, true);
    });
    emit({
        done: true
    });
}
