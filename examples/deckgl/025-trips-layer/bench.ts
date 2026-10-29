import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.ts';
import type { TripsMap } from './trips.ts';

export async function run(map: TripsMap, firstFrameMs: number): Promise<void> {
  const { gl, cam } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl), trips: map.trips, segments: map.segments, buildings: map.buildings, buildingVertices: map.buildingVertices, buildingIndices: map.buildingIndices } });
  const initial = { ...cam };
  await benchFrames(gl, 300, (i) => {
    const u = i / 299;
    cam.x = initial.x + 0.00015 * Math.sin(u * Math.PI * 2);
    cam.y = initial.y + 0.0001 * Math.sin(u * Math.PI * 4);
    cam.zoom = initial.zoom + 0.7 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
    map.setTime(300 + 1100 * u);
  });
  Object.assign(cam, initial);
  map.setTime(900);
  await benchFrames(gl, 60, () => map.draw(), { prefix: 'whole_' });

  map.draw();
  const pixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let buildings = 0, orange = 0, cyan = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (r > 35 && g > 45 && b > 55) buildings++;
    if (r > 110 && r > g * 1.2 && g > b * 1.05) orange++;
    if (g > 100 && b > 100 && b > r * 1.3) cyan++;
  }
  emit({ check: 'visible-buildings-and-trips', pass: buildings > 1000 && orange > 10 && cyan > 10, detail: `buildings=${buildings}, orange=${orange}, cyan=${cyan}` });

  map.setTime(600);
  const early = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, early);
  map.setTime(1200);
  const late = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, late);
  let changed = 0;
  for (let i = 0; i < early.length; i += 16) if (early[i] !== late[i] || early[i + 1] !== late[i + 1]) changed++;
  emit({ check: 'time-changes-trails', pass: changed > 500, detail: `${changed} sampled pixels changed` });

  map.setTime(900);
  map.setTrail(60);
  const short = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, short);
  map.setTrail(300);
  const long = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, long);
  changed = 0;
  for (let i = 0; i < short.length; i += 16) if (short[i] !== long[i] || short[i + 1] !== long[i + 1]) changed++;
  emit({ check: 'trail-changes-screen', pass: changed > 300, detail: `${changed} sampled pixels changed` });
  emit({ check: 'static-gpu-upload', pass: map.uploads === 3, detail: `${map.uploads} uploads for 300 frames` });
  map.setTrail(180);
  emit({ done: true });
}
