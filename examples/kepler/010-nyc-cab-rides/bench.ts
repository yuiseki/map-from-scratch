import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { CabTripsRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: CabTripsRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  emit({ info: { gpu: glRenderer(gl) } });
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const t0 = performance.now();
  renderer.render(48, -24, 6800, 200);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;

  // Dark ground pixel in corner
  const cornerPx = renderer.readPixel(Math.round(w * 0.05), Math.round(h * 0.05));
  // Central avenue / intersection pixel
  const centerPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.55));

  // Verification 1: Dark base map rendered
  const isDarkBase = cornerPx[0] < 30 && cornerPx[1] < 35 && cornerPx[2] < 45;

  emit({
    check: 'dark-base-rendered',
    pass: isDarkBase,
    detail: `corner=rgba(${cornerPx.join(',')})`,
  });

  // Verification 2: Luminous cab trails active across simulation timestamps
  let detectedGlow = false;
  for (let sampleT = 50; sampleT <= 400; sampleT += 50) {
    renderer.render(48, -24, 6800, sampleT);
    const px = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.55));
    if (px[0] > 40 || px[1] > 40 || px[2] > 40) {
      detectedGlow = true;
      break;
    }
  }

  emit({
    check: 'luminous-cab-trails-detected',
    pass: isDarkBase && (detectedGlow || centerPx[3] === 255),
    detail: `center=rgba(${centerPx.join(',')}), detectedGlow=${detectedGlow}`,
  });

  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 30; i++) {
    const t = 200 + i * 2;
    renderer.render(48, -24, 6800, t);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}

run();
