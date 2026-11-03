import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { PointCloudRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: PointCloudRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  renderer.setCameraAngles(0.6, 0.45);
  renderer.setCameraDistance(160.0);

  // Measure first frame
  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Check 1: Space background cleared
  const bgPixel = renderer.readPixel(10, h - 10);
  const bgPass = bgPixel[0] < 30 && bgPixel[1] < 30 && bgPixel[2] < 45;
  emit({
    check: 'space-background-cleared',
    pass: bgPass,
    detail: `bg pixel RGBA=${bgPixel.join(',')}`,
  });

  // Helper to scan a small area for discrete point cloud particles
  function hasParticleNear(cx: number, cy: number, rad: number): boolean {
    const size = rad * 2 + 1;
    const px = new Uint8Array(size * size * 4);
    gl.readPixels(cx - rad, cy - rad, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0; i < px.length; i += 4) {
      // Check if pixel deviates significantly from background (8, 10, 18)
      if (px[i] > 20 || px[i + 1] > 25 || px[i + 2] > 35) {
        return true;
      }
    }
    return false;
  }

  // Check 2: Point cloud surface rendered
  const centerPass = hasParticleNear(cx, cy, 25);
  emit({
    check: 'point-cloud-surface-rendered',
    pass: centerPass,
    detail: `center 50x50 region checked for point cloud particles`,
  });

  // Step simulation forward for dynamic wave progression
  for (let i = 0; i < 15; i++) {
    renderer.render(0.03);
  }

  // Check 3: Wave crests or slopes illuminated
  const wavePass = hasParticleNear(cx + Math.floor(w * 0.12), cy, 25);
  emit({
    check: 'wave-crests-illuminated',
    pass: wavePass,
    detail: `wave 50x50 region checked for point cloud particles`,
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
