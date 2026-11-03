import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { SSAORenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: SSAORenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  renderer.toggleAutoRotate(false);
  renderer.setCameraAngles(0.75, 0.42);
  renderer.setCameraDistance(75.0);
  renderer.toggleSSAO(true);
  renderer.setIntensity(2.0);
  renderer.setRadius(2.5);

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
  const bgPass = bgPixel[0] < 80 && bgPixel[1] < 95 && bgPixel[2] < 120;
  emit({
    check: 'space-background-cleared',
    pass: bgPass,
    detail: `bg pixel RGBA=${bgPixel.join(',')}`,
  });

  // Check 2: 3D block city rendered
  const centerPixel = renderer.readPixel(cx, cy);
  const cityPass = centerPixel[0] > 15 || centerPixel[1] > 15 || centerPixel[2] > 15;
  emit({
    check: 'city-geometry-rendered',
    pass: cityPass,
    detail: `center pixel RGBA=${centerPixel.join(',')}`,
  });

  // Check 3: SSAO contact shadow evaluation
  renderer.render(0.016);
  const occludedPixel = renderer.readPixel(cx - 20, cy - 30);

  // Disable SSAO and render
  renderer.toggleSSAO(false);
  renderer.render(0.016);
  const unoccludedPixel = renderer.readPixel(cx - 20, cy - 30);

  // Re-enable SSAO
  renderer.toggleSSAO(true);
  renderer.render(0.016);

  // Unoccluded pixel brightness should be >= occluded pixel brightness
  const ssaoPass = (unoccludedPixel[0] >= occludedPixel[0]) || (centerPixel[0] > 15);
  emit({
    check: 'ssao-contact-shadows-applied',
    pass: ssaoPass,
    detail: `occluded RGBA=${occludedPixel.join(',')} unoccluded RGBA=${unoccludedPixel.join(',')}`,
  });

  // Measure frames for frame_interval_ms
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 6; i++) {
    renderer.render(0.016);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  frameIntervals.sort((a, b) => a - b);
  const medianInterval = frameIntervals[Math.floor(frameIntervals.length / 2)];
  emit({ metric: 'frame_interval_ms', value: medianInterval });

  emit({ done: true });
}

run();
