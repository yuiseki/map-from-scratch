import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { CommuteRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: CommuteRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  emit({ info: { gpu: glRenderer(gl) } });
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const t0 = performance.now();
  renderer.render(52, -14, 680000);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;

  // Dark background in upper corner
  const cornerPx = renderer.readPixel(Math.round(w * 0.05), Math.round(h * 0.05));
  // Central UK Midlands / London commute bundle
  const centerPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.55));

  // Verification 1: Dark ground rendered
  const isDarkBase = cornerPx[0] < 30 && cornerPx[1] < 35 && cornerPx[2] < 45;

  emit({
    check: 'dark-base-rendered',
    pass: isDarkBase,
    detail: `corner=rgba(${cornerPx.join(',')})`,
  });

  // Verification 2: 3D Commute arcs rendered
  const hasArcs = centerPx[3] === 255;
  emit({
    check: 'commute-arcs-rendered',
    pass: isDarkBase && hasArcs,
    detail: `center=rgba(${centerPx.join(',')})`,
  });

  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 30; i++) {
    const bearing = -14 + i * 0.5;
    renderer.render(52, bearing, 680000);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}

run();
