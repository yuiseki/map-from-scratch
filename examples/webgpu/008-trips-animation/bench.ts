import { emit, benchFramesGpu } from '../../../harness/page/bench.ts';
import type { Camera } from './render.ts';

export interface BenchIo {
  device: GPUDevice;
  gpu: string;
  draw(camera: Camera, toOffscreen?: boolean): void;
  readScreen(camera: Camera): Promise<Uint8Array>;
  camera: Camera;
  ready(): boolean;
  freeze(): void;
}

const BACKGROUND = [9, 14, 20]; // [0.035, 0.055, 0.08] * 255

export async function run(io: BenchIo): Promise<void> {
  const nextFrame = () => new Promise(r => requestAnimationFrame(r));
  while (!io.ready()) await nextFrame();

  io.draw(io.camera);
  await io.device.queue.onSubmittedWorkDone();

  emit({ metric: 'first_frame_ms', value: performance.now() });
  emit({ info: { gpu: io.gpu, renderer: 'WebGPU Trips & Buildings' } });

  io.freeze();

  // Verification 1 & 2: Buildings & Trips visible
  const screen500 = await io.readScreen(io.camera);
  let buildingPixels = 0;
  let yellowPixels = 0;
  let greenPixels = 0;

  for (let i = 0; i < screen500.length; i += 4) {
    const r = screen500[i], g = screen500[i + 1], b = screen500[i + 2];
    const isBg = Math.abs(r - BACKGROUND[0]) <= 3 &&
                 Math.abs(g - BACKGROUND[1]) <= 3 &&
                 Math.abs(b - BACKGROUND[2]) <= 3;
    if (!isBg) {
      // Check building shade (slate gray: r ~= 0.18*s, g ~= 0.24*s, b ~= 0.32*s)
      if (b > r && g > r && r < 120 && b < 160) {
        buildingPixels++;
      }
      // Check yellow cab trails (amber/gold: r high, g high, b low)
      if (r > 150 && g > 100 && b < 80) {
        yellowPixels++;
      }
      // Check green cab trails (emerald: g high, b high, r low)
      if (g > 140 && b > 80 && r < 90) {
        greenPixels++;
      }
    }
  }

  emit({
    check: 'buildings-rendered',
    pass: buildingPixels >= 8000,
    detail: { buildingPixels },
  });

  emit({
    check: 'trips-visible',
    pass: yellowPixels >= 30 && greenPixels >= 30,
    detail: { yellowPixels, greenPixels },
  });

  // Verification 3: Time advances trails (compare t=900 vs t=1500)
  const prevTime = io.camera.time;
  io.camera.time = 1500;
  const screen1500 = await io.readScreen(io.camera);
  io.camera.time = prevTime;

  let diffCount = 0;
  for (let i = 0; i < screen500.length; i += 4) {
    const dr = Math.abs(screen500[i] - screen1500[i]);
    const dg = Math.abs(screen500[i + 1] - screen1500[i + 1]);
    const db = Math.abs(screen500[i + 2] - screen1500[i + 2]);
    if (dr + dg + db > 25) diffCount++;
  }
  const diffRatio = diffCount / (screen500.length / 4);
  emit({
    check: 'time-advances-trails',
    pass: diffRatio >= 0.003,
    detail: { diffPixels: diffCount, diffRatio: diffRatio.toFixed(4) },
  });

  // Scenario 2: orbit-path (300 frames advancing time and bearing)
  const cam = io.camera;
  const initBearing = cam.bearing;
  const initZoom = cam.zoom;
  const initPitch = cam.pitch;

  await benchFramesGpu(io.device, 300, (step: number) => {
    const t = step / 300;
    cam.bearing = (initBearing + t * 90) % 360;
    cam.time = (900 + t * 400) % 1800;
    cam.pitch = initPitch + 8 * Math.sin(t * Math.PI * 2);
    cam.zoom = initZoom + 0.3 * Math.sin(t * Math.PI);
    io.draw(cam, true);
  });

  emit({ done: true });
}
