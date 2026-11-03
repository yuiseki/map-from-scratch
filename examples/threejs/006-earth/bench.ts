import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { EarthRenderer } from './globe.ts';

export async function run(renderer: EarthRenderer, firstFrame: () => number): Promise<void> {
  const gl = renderer.gl;
  gl.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    emit({ error: 'webglcontextlost' });
  });
  emit({ info: { gpu: glRenderer(gl), sphere_triangles: 96 * 192 * 2, texture_bytes: 2048 * 1024 * 3 } });
  for (let i = 0; i < 30 && !firstFrame(); i++) await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrame() });

  // Read back synchronously after our own draw; Chromium may discard the
  // default drawing buffer after a presented frame.
  renderer.render(0.15, -0.12, 3.45);
  const center = renderer.readPixel(Math.floor(gl.canvas.width / 2), Math.floor(gl.canvas.height / 2));
  const corner = renderer.readPixel(4, 4);
  const earthVisible = center[3] === 255 && Math.hypot(center[0] - corner[0], center[1] - corner[1], center[2] - corner[2]) > 15;
  emit({ check: 'earth-visible', pass: earthVisible, detail: `center=${[...center]}, corner=${[...corner]}` });
  const edge = renderer.readPixel(Math.floor(gl.canvas.width * 0.668), Math.floor(gl.canvas.height * 0.5));
  const atmosphereVisible = edge[2] > edge[0] + 8;
  emit({ check: 'blue-atmosphere', pass: atmosphereVisible, detail: `rim=${[...edge]}` });

  renderer.render(0.95, -0.12, 3.45);
  const rotated = renderer.readPixel(Math.floor(gl.canvas.width / 2), Math.floor(gl.canvas.height / 2));
  const rotationDifference = Math.hypot(center[0] - rotated[0], center[1] - rotated[1], center[2] - rotated[2]);
  emit({ check: 'globe-rotates', pass: rotationDifference > 12, detail: `center color distance after yaw change=${rotationDifference.toFixed(1)}` });

  renderer.render(0.15, -0.12, 3.45);
  const nearEdge = renderer.readPixel(Math.floor(gl.canvas.width / 2) + 160, Math.floor(gl.canvas.height / 2));
  renderer.render(0.15, -0.12, 5.5);
  const farEdge = renderer.readPixel(Math.floor(gl.canvas.width / 2) + 160, Math.floor(gl.canvas.height / 2));
  emit({ check: 'zoom-changes-scale', pass: nearEdge[3] > 200 && farEdge[3] < 32, detail: `near edge alpha=${nearEdge[3]}, far edge alpha=${farEdge[3]}` });

  await benchFrames(gl, 40, (i) => renderer.render(i * Math.PI / 20, -0.12, 3.45));
  emit({ done: true });
}
