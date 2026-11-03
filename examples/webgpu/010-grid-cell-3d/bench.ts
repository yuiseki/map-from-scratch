import { emit, benchFramesGpu } from '../../../harness/page/bench.ts';
import type { Camera } from './render.ts';
import type { GridDataset } from './grid.ts';

export interface BenchIo {
  device: GPUDevice;
  gpu: string;
  draw(cam: Camera, toOffscreen?: boolean): void;
  readScreen(cam: Camera): Promise<Uint8Array>;
  camera: Camera;
  dataset(): GridDataset | null;
  ready(): boolean;
  freeze(): void;
}

export async function run(io: BenchIo): Promise<void> {
  const nextFrame = () => new Promise(r => requestAnimationFrame(r));
  while (!io.ready()) await nextFrame();

  io.draw(io.camera);
  await io.device.queue.onSubmittedWorkDone();
  emit({ metric: 'first_frame_ms', value: performance.now() });
  emit({ info: { gpu: io.gpu, renderer: 'WebGPU 3D GridCellLayer' } });

  io.freeze();

  // Verification: readback screen pixel
  const pixels = await io.readScreen(io.camera);
  const [w, h] = [io.camera.width || 1280, io.camera.height || 800];

  let gridPixelCount = 0;
  // Scan center area for grid green/lime/cyan colors
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++) {
    for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      // Density colors have significant green (g > 60) distinct from dark slate background (g ~ 25)
      if (g > 60 && (r > 30 || b > 30)) {
        gridPixelCount++;
      }
    }
  }

  const pass = gridPixelCount > 50;
  emit({
    check: 'check-rendered-grid',
    pass,
    detail: { detectedGridPixels: gridPixelCount },
  });

  // Benchmark loop: 180 frames orbiting camera
  const cam = io.camera;
  const initialYaw = cam.yaw;
  await benchFramesGpu(io.device, 180, (step: number) => {
    cam.yaw = (initialYaw + step * 0.5) % 360;
    io.draw(cam, true);
  });

  emit({ done: true });
}
