import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { TerrainRenderer } from './render.ts';

export async function run(renderer: TerrainRenderer, firstFrame: () => number): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); emit({ error: 'webglcontextlost' }); });
  emit({ info: { gpu: glRenderer(gl), grid: '128x128', triangles: 128 * 127 * 2, input_tile: '12/3627/1615.webp' } });
  for (let i = 0; i < 30 && !firstFrame(); i++) await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrame() });

  renderer.render(-0.35, 0.82, 3.6);
  const center = renderer.readPixel(Math.floor(gl.canvas.width / 2), Math.floor(gl.canvas.height / 2));
  const sky = renderer.readPixel(4, 4);
  emit({ check: 'terrain-visible', pass: center[3] === 255 && Math.hypot(center[0] - sky[0], center[1] - sky[1], center[2] - sky[2]) > 20, detail: `center=${[...center]}, sky=${[...sky]}` });

  const sampleGrid = (yaw: number): number[][] => {
    renderer.render(yaw, 0.82, 3.6);
    const values: number[][] = [];
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 7; gx++) {
      const x = Math.floor(gl.canvas.width * (0.42 + gx * 0.026));
      const y = Math.floor(gl.canvas.height * (0.40 + gy * 0.033));
      values.push([...renderer.readPixel(x, y)]);
    }
    return values;
  };
  const first = sampleGrid(-0.35);
  const second = sampleGrid(0.8);
  const rotationDifference = first.reduce((sum, a, i) => sum + Math.abs(a[0] - second[i][0]) + Math.abs(a[1] - second[i][1]) + Math.abs(a[2] - second[i][2]), 0);
  emit({ check: 'terrain-rotates', pass: rotationDifference > 250, detail: `sum of RGB differences in a 7x7 screen sample after yaw change=${rotationDifference}` });

  await benchFrames(gl, 40, (i) => renderer.render(i * Math.PI / 20, 0.82, 3.6));
  emit({ done: true });
}
