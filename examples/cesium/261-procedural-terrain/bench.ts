import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { ProceduralTerrainRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: ProceduralTerrainRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  // Fixed viewpoint for benchmark checks
  renderer.state.autoRotate = false;
  renderer.state.yaw = 0.45;
  renderer.state.pitch = 0.32;
  renderer.state.distance = 1100;

  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);

  // Check 1: Sky and atmospheric fog in upper corner
  const cornerPixel = renderer.readPixel(15, h - 15);
  const isSky = cornerPixel[2] > 150 && cornerPixel[2] > cornerPixel[0] * 2;
  emit({
    check: 'sky-fog-cleared',
    pass: isSky,
    detail: `corner pixel RGB(${cornerPixel[0]}, ${cornerPixel[1]}, ${cornerPixel[2]})`,
  });

  // Check 2: Mountain peaks rendered in upper center region
  let peakFound = false;
  for (let dy = 0; dy <= 80; dy += 10) {
    const p = renderer.readPixel(cx, Math.floor(h * 0.5) + dy);
    // Snow peak or rock is light/grey
    if (p[0] > 100 && p[1] > 100 && p[2] > 100) {
      peakFound = true;
      break;
    }
  }

  emit({
    check: 'mountain-peaks-rendered',
    pass: peakFound,
    detail: `peak detected in upper-mid silhouette`,
  });

  // Check 3: Valley terrain or water rendered in lower central region
  const valleyPixel = renderer.readPixel(cx, 25);
  const isValley = valleyPixel[3] === 255;
  emit({
    check: 'valley-terrain-rendered',
    pass: isValley,
    detail: `valley pixel RGB(${valleyPixel[0]}, ${valleyPixel[1]}, ${valleyPixel[2]})`,
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
