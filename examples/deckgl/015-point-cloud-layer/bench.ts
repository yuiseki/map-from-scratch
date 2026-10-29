import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { PointCloud } from './renderer.ts';

export async function run(map: PointCloud, firstFrameMs: number): Promise<void> {
  const { gl } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl), points: map.count, format: '3×10-bit XYZ, one uint32 per point' } });
  emit({ check: 'all-points-loaded', pass: map.count === 808042, detail: String(map.count) });
  const initial = { yaw: map.yaw, pitch: map.pitch, distance: map.distance };
  await benchFrames(gl, 240, (i) => {
    const t = i / 239;
    map.yaw = initial.yaw + t * Math.PI * 2;
    map.pitch = 0.1 + 0.6 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    map.distance = 32 + 15 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    map.draw();
  });
  Object.assign(map, initial);
  await benchFrames(gl, 60, () => map.draw(), { prefix: 'whole_' });
  const sample = (): Uint8Array => {
    map.draw();
    const out = new Uint8Array(map.canvas.width * map.canvas.height * 4);
    gl.readPixels(0, 0, map.canvas.width, map.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  const before = sample();
  let visible = 0;
  for (let i = 0; i < before.length; i += 4) if (before[i] > 35 && before[i + 1] > 45 && before[i + 2] > 55) visible++;
  emit({ check: 'point-cloud-visible', pass: visible > 15000, detail: `${visible} visible pixels` });
  map.yaw += Math.PI / 2;
  const after = sample();
  let changed = 0;
  for (let i = 0; i < before.length; i += 16) if (before[i] !== after[i] || before[i + 1] !== after[i + 1]) changed++;
  emit({ check: 'orbit-changes-screen', pass: changed > 3000, detail: `${changed} changed samples` });
  Object.assign(map, initial);
  map.pan(110, 40);
  const moved = sample();
  let panChanged = 0;
  for (let i = 0; i < before.length; i += 16) if (before[i] !== moved[i] || before[i + 1] !== moved[i + 1]) panChanged++;
  emit({ check: 'pan-changes-screen', pass: panChanged > 3000, detail: `${panChanged} changed samples` });
  map.center = [0, 0, 0];
  map.distance = initial.distance * 0.7;
  const zoomed = sample();
  let zoomChanged = 0;
  for (let i = 0; i < before.length; i += 16) if (before[i] !== zoomed[i] || before[i + 1] !== zoomed[i + 1]) zoomChanged++;
  emit({ check: 'zoom-changes-screen', pass: zoomChanged > 3000, detail: `${zoomChanged} changed samples` });
  Object.assign(map, initial); map.draw();
  emit({ done: true });
}
