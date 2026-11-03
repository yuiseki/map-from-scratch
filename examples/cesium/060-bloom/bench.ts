import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { BloomRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: BloomRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  renderer.setCameraAngles(0.55, 0.28);
  renderer.setCameraDistance(110.0);

  // Measure first frame
  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Check 1: Dark scene background cleared
  const bgPixel = renderer.readPixel(10, h - 10);
  const bgPass = bgPixel[0] < 50 && bgPixel[1] < 50 && bgPixel[2] < 65;
  emit({
    check: 'dark-scene-cleared',
    pass: bgPass,
    detail: `bg pixel RGBA=${bgPixel.join(',')}`,
  });

  // Check 2: Neon tower geometry rendered
  const towerPixel = renderer.readPixel(cx, cy);
  const towerPass = towerPixel[0] > 10 || towerPixel[1] > 10 || towerPixel[2] > 15;
  emit({
    check: 'neon-geometry-rendered',
    pass: towerPass,
    detail: `tower pixel RGBA=${towerPixel.join(',')}`,
  });

  // Step simulation forward to let bloom diffuse
  for (let i = 0; i < 5; i++) {
    renderer.render(0.016);
  }

  // Check 3: Bloom glow diffused into space above towers
  const haloPixel = renderer.readPixel(cx, Math.floor(h * 0.72));
  const haloPass = haloPixel[0] > 3 || haloPixel[1] > 3 || haloPixel[2] > 3;
  emit({
    check: 'bloom-glow-diffused',
    pass: haloPass,
    detail: `halo pixel RGBA=${haloPixel.join(',')}`,
  });

  // Measure 15 frames for frame_interval_ms
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
