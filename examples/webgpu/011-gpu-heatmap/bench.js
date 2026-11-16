import { emit, benchFramesGpu } from '../../../harness/page/bench.js';
export async function run(io) {
    const nextFrame = ()=>new Promise((r)=>requestAnimationFrame(r));
    while(!io.ready())await nextFrame();
    io.renderer.render(io.view);
    await io.device.queue.onSubmittedWorkDone();
    emit({
        metric: 'first_frame_ms',
        value: performance.now()
    });
    emit({
        info: {
            gpu: io.gpu,
            renderer: 'WebGPU GPU Heatmap'
        }
    });
    const pixels = await io.renderer.readScreen(io.view);
    const w = io.view.width ?? 1280;
    const h = io.view.height ?? 800;
    let heatPixelCount = 0;
    for(let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++){
        for(let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++){
            const idx = (y * w + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            if (r > 30 || g > 40 || b > 60) {
                heatPixelCount++;
            }
        }
    }
    const pass = heatPixelCount > 100;
    emit({
        check: 'visible-heatmap',
        pass,
        detail: {
            detectedHeatPixels: heatPixelCount
        }
    });
    const view = io.view;
    const initialLon = view.center[0];
    await benchFramesGpu(io.device, 180, (step)=>{
        view.center[0] = initialLon + Math.sin(step * 0.05) * 0.01;
        io.renderer.render(view);
    });
    emit({
        done: true
    });
}
