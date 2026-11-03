import { emit, benchFramesGpu } from '../../../harness/page/bench.ts';
import type { Camera } from './render.ts';
import type { ArcDataset } from './arc.ts';

export interface BenchIo {
  device: GPUDevice;
  gpu: string;
  draw(cam: Camera, toOffscreen?: boolean): void;
  readScreen(cam: Camera): Promise<Uint8Array>;
  camera: Camera;
  dataset(): ArcDataset | null;
  ready(): boolean;
  freeze(): void;
}

export async function run(io: BenchIo): Promise<void> {
  const nextFrame = () => new Promise(r => requestAnimationFrame(r));
  while (!io.ready()) await nextFrame();

  io.draw(io.camera);
  await io.device.queue.onSubmittedWorkDone();
  emit({ metric: 'first_frame_ms', value: performance.now() });
  emit({ info: { gpu: io.gpu, renderer: 'WebGPU 3D ArcLayer' } });

  io.freeze();

  // Verification: readback screen pixel
  const pixels = await io.readScreen(io.camera);
  const [w, h] = [io.camera.width || 1280, io.camera.height || 800];

  let arcPixelCount = 0;
  // Scan center area for cyan/blue (b > 100, r < 120, g > 80) or magenta/rose (r > 120, b > 70)
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++) {
    for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
      if ((b > 100 && r < 120 && g > 80) || (r > 120 && b > 70)) {
        arcPixelCount++;
      }
    }
  }

  const pass = arcPixelCount > 30;
  emit({
    check: 'check-rendered-arcs',
    pass,
    detail: { detectedArcPixels: arcPixelCount },
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
