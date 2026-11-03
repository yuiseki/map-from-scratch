import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { CanyonRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: CanyonRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  emit({ info: { gpu: glRenderer(gl) } });
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const t0 = performance.now();
  renderer.render(78, 18, 7600);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;

  // Sky pixel near top
  const skyPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.08));
  // Granite cliff face pixel
  const cliffPx = renderer.readPixel(Math.round(w * 0.72), Math.round(h * 0.45));
  // Valley floor forest pixel
  const valleyPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.82));

  // Verification 1: Canyon terrain rendered against sky
  const isSky = skyPx[0] > 120 && skyPx[1] > 160 && skyPx[2] > 190;
  const isTerrain = valleyPx[3] === 255 && (Math.abs(valleyPx[0] - skyPx[0]) > 25 || Math.abs(valleyPx[2] - skyPx[2]) > 25);

  emit({
    check: 'canyon-terrain-rendered',
    pass: isSky && isTerrain,
    detail: `valley=rgba(${valleyPx.join(',')}), sky=rgba(${skyPx.join(',')})`,
  });

  // Verification 2: Cliff granite color vs valley pine forest contrast
  const hasRockContrast = (cliffPx[0] > valleyPx[0] + 15) && (cliffPx[2] > valleyPx[2] + 10);
  emit({
    check: 'cliff-granite-contrast',
    pass: hasRockContrast,
    detail: `cliff=rgba(${cliffPx.join(',')}), valley=rgba(${valleyPx.join(',')})`,
  });

  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 30; i++) {
    const bearing = 18 + i * 0.5;
    renderer.render(78, bearing, 7600);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}

run();
