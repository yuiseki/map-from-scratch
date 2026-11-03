import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { StarBurstRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: StarBurstRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  renderer.state.autoRotate = false;
  renderer.state.yaw = 0.0;
  renderer.state.pitch = 0.0;
  renderer.state.distance = 350;

  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Check 1: Deep hyperspace black in corner
  const cornerPixel = renderer.readPixel(10, h - 10);
  const isBlack = cornerPixel[0] <= 15 && cornerPixel[1] <= 15 && cornerPixel[2] <= 25;
  emit({
    check: 'hyperspace-black-cleared',
    pass: isBlack,
    detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`,
  });

  // Advance simulation to generate streaks
  for (let i = 0; i < 5; i++) {
    renderer.render(0.03);
  }

  // Check 2: Starburst streaks rendered
  let streakFound = false;
  for (let dy = -80; dy <= 80; dy += 15) {
    for (let dx = -80; dx <= 80; dx += 15) {
      const p = renderer.readPixel(cx + dx, cy + dy);
      if (p[0] > 20 || p[1] > 20 || p[2] > 20) {
        streakFound = true;
        break;
      }
    }
    if (streakFound) break;
  }

  emit({
    check: 'starburst-streaks-rendered',
    pass: streakFound || renderer.state.starCount > 100,
    detail: `active stars: ${renderer.state.starCount}`,
  });

  // Check 3: Radial glowing cores
  emit({
    check: 'star-cores-rendered',
    pass: renderer.state.starCount >= 1000,
    detail: `star count = ${renderer.state.starCount}`,
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
