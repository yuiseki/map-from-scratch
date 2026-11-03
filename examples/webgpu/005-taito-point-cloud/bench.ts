import { benchFramesGpu, emit, type FrameTimestamps } from '../../../harness/page/bench.ts';
import { measure, type VisibleTile } from '../../23-taito-point-cloud/bench.ts';
import type { Origin } from '../../23-taito-point-cloud/decode.ts';
import type { Camera, Mesh, Timestamps } from './render.ts';

export interface App {
  device: GPUDevice;
  gpu: string;
  draw(camera: Camera, meshes: Mesh[], ts?: Timestamps, toOffscreen?: boolean): void;
  readScreen(camera: Camera, meshes: Mesh[]): Promise<Uint8Array>;
  size(): [number, number];
  camera: Camera;
  origin: Origin;
  ready(): boolean;
  freeze(): void;
  idle(): boolean;
  visible(): VisibleTile<Mesh>[];
  error(): string;
}

export async function run(app: App): Promise<void> {
  const { device, camera } = app;
  device.lost.then((e) => emit({ error: `WebGPU device lost: ${e.message}` }));
  await measure<Mesh>({
    camera,
    origin: app.origin,
    info: { gpu: app.gpu, api: 'webgpu', timestamps: device.features.has('timestamp-query') },
    ready: app.ready,
    freeze: app.freeze,
    idle: app.idle,
    visible: app.visible,
    error: app.error,
    size: app.size,
    draw: (meshes) => app.draw(camera, meshes),
    finish: async () => { await device.queue.onSubmittedWorkDone(); },
    frames: (steps, set, meshes, prefix) =>
      benchFramesGpu(device, steps, (i, ts) => {
        set(i);
        app.draw(camera, meshes, ts as Timestamps, true);
      }, { prefix }),
    screen: (meshes) => app.readScreen(camera, meshes),
  });
}
