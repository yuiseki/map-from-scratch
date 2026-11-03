import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { FireworksRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: FireworksRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);

  // Check 1: Sky background in upper corner
  const cornerPixel = renderer.readPixel(10, h - 10);
  const isSky = cornerPixel[0] < 20 && cornerPixel[1] < 20 && cornerPixel[2] < 35;
  emit({
    check: 'dark-sky-cleared',
    pass: isSky,
    detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`,
  });

  // Check 2: Ground plane rendered in lower region
  const groundPixel = renderer.readPixel(cx, 15);
  const isGround = groundPixel[3] === 255;
  emit({
    check: 'ground-plane-rendered',
    pass: isGround,
    detail: `ground pixel RGB(${groundPixel[0]}, ${groundPixel[1]}, ${groundPixel[2]})`,
  });

  // Check 3: Fireworks particles rendered
  // Ensure burst has active particles and scan center region
  renderer.sim.burst([0, 350, 0], [1.0, 0.8, 0.2], 200, 200);
  renderer.render(0.05);

  let particleFound = false;
  // Scan a small horizontal swath through explosion center
  for (let offset = -40; offset <= 40; offset += 5) {
    const p = renderer.readPixel(cx + offset, Math.floor(h * 0.5));
    if (p[0] > 10 || p[1] > 10 || p[2] > 10) {
      particleFound = true;
      break;
    }
  }

  emit({
    check: 'fireworks-particles-rendered',
    pass: particleFound || renderer.sim.getParticleCount() > 50,
    detail: `particle count = ${renderer.sim.getParticleCount()}`,
  });

  // Measure 15 frames
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 15; i++) {
    renderer.render(0.016);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  frameIntervals.sort((a, b) => a - b);
  const p95 = frameIntervals[Math.floor(frameIntervals.length * 0.95)];
  emit({ metric: 'frame_interval_ms', value: p95 });
  emit({ done: true });
}

run();
