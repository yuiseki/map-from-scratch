import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { TranslucencyRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: TranslucencyRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  renderer.setCameraAngles(0.4, 0.25);
  renderer.setCameraDistance(210.0);

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

  // Check 2: Core visible through translucent crust (center has warm golden/orange emissive core color)
  const centerPixel = renderer.readPixel(cx, cy);
  const centerPass = centerPixel[0] > 40 && centerPixel[1] > 30;
  emit({
    check: 'subterranean-core-visible',
    pass: centerPass,
    detail: `center pixel RGBA=${centerPixel.join(',')}`,
  });

  // Check 3: Translucent crust rim rendered with atmospheric glow
  const rimPixel = renderer.readPixel(cx + Math.floor(w * 0.18), cy);
  const rimPass = rimPixel[0] > 10 || rimPixel[1] > 20 || rimPixel[2] > 30;
  emit({
    check: 'translucent-crust-rendered',
    pass: rimPass,
    detail: `rim pixel RGBA=${rimPixel.join(',')}`,
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
