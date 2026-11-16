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
            renderer: 'WebGPU Instanced Scatterplot'
        }
    });
    const pixels = await io.renderer.readScreen(io.view);
    const w = io.view.width ?? 1280;
    const h = io.view.height ?? 800;
    let blueCount = 0;
    let amberCount = 0;
    for(let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++){
        for(let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++){
            const idx = (y * w + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            if (b > 120 && r < 80) {
                blueCount++;
            }
            if (r > 150 && g > 100 && b < 100) {
                amberCount++;
            }
        }
    }
    const pass = blueCount > 20 && amberCount > 20;
    emit({
        check: 'visible-scatterplot',
        pass,
        detail: {
            bluePixels: blueCount,
            amberPixels: amberCount
        }
    });
    const view = io.view;
    const initialLon = view.center[0];
    await benchFramesGpu(io.device, 180, (step)=>{
        view.center[0] = initialLon + Math.sin(step * 0.05) * 0.005;
        io.renderer.render(view);
    });
    emit({
        done: true
    });
}
