// Benchmark and verification script for WebGPU Heatmap
import { emit, benchFramesGpu } from '../../../harness/page/bench.ts';
import type { ViewState, WebGPUHeatmapRenderer } from './render.ts';

export interface BenchIo {
  device: GPUDevice;
  gpu: string;
  renderer: WebGPUHeatmapRenderer;
  view: ViewState;
  ready: () => boolean;
}

export async function run(io: BenchIo): Promise<void> {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  while (!io.ready()) await nextFrame();

  io.renderer.render(io.view);
  await io.device.queue.onSubmittedWorkDone();
  emit({ metric: 'first_frame_ms', value: performance.now() });
  emit({ info: { gpu: io.gpu, renderer: 'WebGPU GPU Heatmap' } });

  // Verification: readback screen pixels
  const pixels = await io.renderer.readScreen(io.view);
  const w = io.view.width ?? 1280;
  const h = io.view.height ?? 800;

  let heatPixelCount = 0;
  // Background is dark navy: r ~ 11, g ~ 19, b ~ 28
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.8); y++) {
    for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.8); x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      // Heatmap pixels have higher brightness or distinct blue/cyan/yellow/red tones
      if (r > 30 || g > 40 || b > 60) {
        heatPixelCount++;
      }
    }
  }

  const pass = heatPixelCount > 100;
  emit({
    check: 'visible-heatmap',
    pass,
    detail: { detectedHeatPixels: heatPixelCount },
  });

  // Benchmark loop: 180 frames panning slightly
  const view = io.view;
  const initialLon = view.center[0];
  await benchFramesGpu(io.device, 180, (step: number) => {
    view.center[0] = initialLon + Math.sin(step * 0.05) * 0.01;
    io.renderer.render(view);
  });

  emit({ done: true });
}
