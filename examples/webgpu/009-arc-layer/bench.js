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
            renderer: 'WebGPU 3D ArcLayer'
        }
    });
    io.freeze();
    const pixels = await io.readScreen(io.camera);
    const [w, h] = [
        io.camera.width || 1280,
        io.camera.height || 800
    ];
    let arcPixelCount = 0;
    for(let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++){
        for(let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++){
            const idx = (y * w + x) * 4;
            const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
            if (b > 100 && r < 120 && g > 80 || r > 120 && b > 70) {
                arcPixelCount++;
            }
        }
    }
    const pass = arcPixelCount > 30;
    emit({
        check: 'check-rendered-arcs',
        pass,
        detail: {
            detectedArcPixels: arcPixelCount
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
