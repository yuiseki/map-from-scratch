// Benchmark and verification script for WebGPU 3D Terrain Layer
import { emit, benchFramesGpu } from '../../../harness/page/bench.ts';
import type { Camera, WebGPUTerrainRenderer } from './render.ts';

export interface BenchIo {
  device: GPUDevice;
  gpu: string;
  renderer: WebGPUTerrainRenderer;
  camera: Camera;
  ready: () => boolean;
}

export async function run(io: BenchIo): Promise<void> {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  while (!io.ready()) await nextFrame();

  io.renderer.render(io.camera);
  await io.device.queue.onSubmittedWorkDone();
  emit({ metric: 'first_frame_ms', value: performance.now() });
  emit({ info: { gpu: io.gpu, renderer: 'WebGPU 3D Terrain' } });

  // Verification: readback screen pixels
  const pixels = await io.renderer.readScreen(io.camera);
  const w = io.camera.width ?? 1280;
  const h = io.camera.height ?? 800;

  let terrainPixelCount = 0;
  // Background sky color: r ~ 25, g ~ 38, b ~ 56
  // Terrain has forest green (g > 60), volcanic brown (r > 60, g > 50), or summit snow (r > 150, g > 150)
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.9); y++) {
    for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      if ((g > 60 && r < 100) || (r > 80 && g > 60) || (r > 150 && g > 150 && b > 150)) {
        terrainPixelCount++;
      }
    }
  }

  const pass = terrainPixelCount > 100;
  emit({
    check: 'visible-terrain',
    pass,
    detail: { detectedTerrainPixels: terrainPixelCount },
  });

  // Benchmark loop: 180 frames orbiting camera
  const cam = io.camera;
  const initialYaw = cam.yaw;
  await benchFramesGpu(io.device, 180, (step: number) => {
    cam.yaw = (initialYaw + step * 0.5) % 360;
    io.renderer.render(cam);
  });

  emit({ done: true });
}
