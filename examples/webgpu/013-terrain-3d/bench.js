import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
export async function run(io) {
    const nextFrame = ()=>new Promise((r)=>requestAnimationFrame(r));
    while(!io.ready())await nextFrame();
    io.renderer.render(io.camera);
    await io.device.queue.onSubmittedWorkDone();
    emit({
        metric: 'first_frame_ms',
        value: performance.now()
    });
    emit({
        info: {
            gpu: io.gpu,
            renderer: 'WebGPU 3D Terrain'
        }
    });
    const pixels = await io.renderer.readScreen(io.camera);
    const w = io.camera.width ?? 1280;
    const h = io.camera.height ?? 800;
    let terrainPixelCount = 0;
    for(let y = Math.floor(h * 0.2); y < Math.floor(h * 0.9); y++){
        for(let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++){
            const idx = (y * w + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const isSky = b > 190 && b - r > 25;
            if (!isSky && (r > 30 || g > 30 || b > 30)) {
                terrainPixelCount++;
            }
        }
    }
    const pass = terrainPixelCount > 100;
    emit({
        check: 'visible-terrain',
        pass,
        detail: {
            detectedTerrainPixels: terrainPixelCount
        }
    });
    const cam = io.camera;
    const initialYaw = cam.yaw;
    await benchFramesGpu(io.device, 180, (step)=>{
        cam.yaw = (initialYaw + step * 0.5) % 360;
        io.renderer.render(cam);
    });
    emit({
        done: true
    });
}
