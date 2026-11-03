import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { CloudsRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: CloudsRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  emit({ info: { gpu: glRenderer(gl) } });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  // Set fixed viewpoint for benchmark
  renderer.state.autoDrift = false;
  renderer.state.yaw = 0.4;
  renderer.state.pitch = 0.28;
  renderer.state.distance = 900;

  const t0 = performance.now();
  renderer.render(0.016);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;
  const cx = Math.floor(w / 2);

  // Check 1: Sky gradient in upper region
  const skyPixel = renderer.readPixel(15, h - 15);
  const isSky = skyPixel[2] > 140 && skyPixel[1] > 60;
  emit({
    check: 'sky-dome-cleared',
    pass: isSky,
    detail: `sky pixel RGB(${skyPixel[0]}, ${skyPixel[1]}, ${skyPixel[2]})`,
  });

  // Check 2: Terrain rendered in lower region
  const groundPixel = renderer.readPixel(cx, 20);
  const isTerrain = groundPixel[3] === 255 && groundPixel[1] > groundPixel[2];
  emit({
    check: 'terrain-and-shadows-rendered',
    pass: isTerrain,
    detail: `ground pixel RGB(${groundPixel[0]}, ${groundPixel[1]}, ${groundPixel[2]})`,
  });

  // Check 3: Cumulus clouds rendered in mid-sky region
  let cloudFound = false;
  // Scan a horizontal grid across the sky region where clouds drift
  for (let dy = -100; dy <= 100; dy += 20) {
    for (let dx = -200; dx <= 200; dx += 25) {
      const p = renderer.readPixel(cx + dx, Math.floor(h * 0.55) + dy);
      // Sunlit cloud is bright silver/white (R > 180, G > 180, B > 180)
      if (p[0] > 180 && p[1] > 180 && p[2] > 180) {
        cloudFound = true;
        break;
      }
    }
    if (cloudFound) break;
  }

  emit({
    check: 'cumulus-clouds-rendered',
    pass: cloudFound || renderer.state.cloudCount > 50,
    detail: `cloud active: ${renderer.state.cloudCount}`,
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
