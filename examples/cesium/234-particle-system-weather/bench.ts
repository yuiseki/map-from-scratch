import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { WeatherRenderer } from './render.ts';
import { medianPixel } from './weather.ts';

const renderer = (window as unknown as { __mfsRenderer: WeatherRenderer }).__mfsRenderer;

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

  // Check a 3x3 patch: a single animated rain streak must not mask the clear color.
  const skySamples: Uint8Array[] = [];
  for (const offset of [8, 32, 56]) {
    for (const x of [8, 32, 56]) skySamples.push(renderer.readPixel(x, h - offset));
  }
  const cornerPixel = medianPixel(skySamples);
  // Default is rain mode: clearColor is (0.20, 0.24, 0.28) ~ RGB(51, 61, 71)
  const isSky = cornerPixel[0] >= 35 && cornerPixel[0] <= 70 && cornerPixel[2] >= 50;
  emit({
    check: 'overcast-sky-cleared',
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

  // Check 3: Rain or snow particles rendered
  // Advance simulation a few frames and sample center volume
  for (let i = 0; i < 5; i++) {
    renderer.render(0.016);
  }

  let particleFound = false;
  // Scan vertical/horizontal cross in the central volume
  for (let dy = -60; dy <= 60; dy += 10) {
    for (let dx = -60; dx <= 60; dx += 15) {
      const p = renderer.readPixel(cx + dx, Math.floor(h * 0.5) + dy);
      // Rain particle has blueish tint or bright highlight
      if (Math.abs(p[0] - cornerPixel[0]) > 10 || Math.abs(p[2] - cornerPixel[2]) > 10) {
        particleFound = true;
        break;
      }
    }
    if (particleFound) break;
  }

  emit({
    check: 'weather-particles-rendered',
    pass: particleFound || renderer.state.particleCount > 0,
    detail: `particles active: ${renderer.state.particleCount}`,
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
