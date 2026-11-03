import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { TerrainRenderer } from './render.ts';

const renderer = (window as unknown as { __mfsRenderer: TerrainRenderer }).__mfsRenderer;

export async function run(): Promise<void> {
  const gl = renderer.gl;
  emit({ info: { gpu: glRenderer(gl) } });
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const t0 = performance.now();
  renderer.render(70, -45, 24000);
  const firstFrame = performance.now() - t0;
  emit({ metric: 'first_frame_ms', value: firstFrame });

  const w = gl.canvas.width;
  const h = gl.canvas.height;

  // Sky pixel near top
  const skyPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.08));
  // Mountain summit/cone pixel near center
  const summitPx = renderer.readPixel(Math.round(w / 2), Math.round(h * 0.45));
  // Lower foothills / pasture near bottom
  const footPx = renderer.readPixel(Math.round(w * 0.25), Math.round(h * 0.88));

  // Verification 1: Mountain terrain rendered against sky
  const isSky = skyPx[0] > 110 && skyPx[1] > 150 && skyPx[2] > 180;
  const isMountain = summitPx[3] === 255 && (Math.abs(summitPx[0] - skyPx[0]) > 20 || Math.abs(summitPx[1] - skyPx[1]) > 20);

  emit({
    check: 'terrain-3d-rendered',
    pass: isSky && isMountain,
    detail: `summit=rgba(${summitPx.join(',')}), sky=rgba(${skyPx.join(',')})`,
  });

  // Verification 2: Elevation hypsometric color contrast (summit vs green foothills)
  // Foothills have higher green channel relative to red
  const hasHypsometricContrast = (footPx[1] > footPx[0] + 15) || (Math.abs(summitPx[0] - footPx[0]) > 25);
  emit({
    check: 'hypsometric-elevation-contrast',
    pass: hasHypsometricContrast,
    detail: `foot=rgba(${footPx.join(',')}), summit=rgba(${summitPx.join(',')})`,
  });

  const frameIntervals: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 30; i++) {
    const bearing = -45 + i * 0.5;
    renderer.render(70, bearing, 24000);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    frameIntervals.push(now - last);
    last = now;
  }

  emit({ metric: 'frame_interval_ms', values: frameIntervals });
  emit({ done: true });
}

run();
