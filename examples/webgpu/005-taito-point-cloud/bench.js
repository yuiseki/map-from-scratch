import { benchFramesGpu, emit } from '../../../harness/page/bench.js';
import { measure } from '../../23-taito-point-cloud/bench.js';
export async function run(app) {
    const { device, camera } = app;
    device.lost.then((e)=>emit({
            error: `WebGPU device lost: ${e.message}`
        }));
    await measure({
        camera,
        origin: app.origin,
        info: {
            gpu: app.gpu,
            api: 'webgpu',
            timestamps: device.features.has('timestamp-query')
        },
        ready: app.ready,
        freeze: app.freeze,
        idle: app.idle,
        visible: app.visible,
        error: app.error,
        size: app.size,
        draw: (meshes)=>app.draw(camera, meshes),
        finish: async ()=>{
            await device.queue.onSubmittedWorkDone();
        },
        frames: (steps, set, meshes, prefix)=>benchFramesGpu(device, steps, (i, ts)=>{
                set(i);
                app.draw(camera, meshes, ts, true);
            }, {
                prefix
            }),
        screen: (meshes)=>app.readScreen(camera, meshes)
    });
}
