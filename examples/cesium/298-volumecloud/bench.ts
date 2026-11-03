import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { VolumeCloudRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: VolumeCloudRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  renderer.toggleAutoRotate(false);
  renderer.setCameraAngles(0.5, 0.25);
  renderer.setCameraDistance(46.0);
  renderer.setSunAngles(1.0, 0.6);
  renderer.setCloudCoverage(0.65);

  // Measure first frame
  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);

  // Check 1: Outer cosmos background cleared
  const bgPixel = renderer.readPixel(10, h - 10);
  const bgPass = bgPixel[0] < 55 && bgPixel[1] < 55 && bgPixel[2] < 70;
  emit({
    check: 'space-background-cleared',
    pass: bgPass,
    detail: `bg pixel RGBA=${bgPixel.join(',')}`,
  });

  // Check 2: Earth globe surface rendered
  const centerPixel = renderer.readPixel(cx, cy);
  const globePass = centerPixel[0] > 10 || centerPixel[1] > 15 || centerPixel[2] > 20;
  emit({
    check: 'earth-globe-rendered',
    pass: globePass,
    detail: `center pixel RGBA=${centerPixel.join(',')}`,
  });

  // Check 3: Volumetric cloud presence
  // Advance simulation to accumulate wind displacement
  for (let i = 0; i < 5; i++) {
    renderer.render(0.016);
  }
  const cloudPixel = renderer.readPixel(cx - 30, cy + 20);
  const cloudPass = cloudPixel[0] > 15 || cloudPixel[1] > 20 || cloudPixel[2] > 25;
  emit({
    check: 'volumetric-clouds-rendered',
    pass: cloudPass,
    detail: `cloud pixel RGBA=${cloudPixel.join(',')}`,
  });

  // Measure frames for frame_interval_ms
  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 8; i++) {
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
