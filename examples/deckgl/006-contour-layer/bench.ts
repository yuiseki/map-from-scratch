import { benchFrames, emit, glRenderer } from '../../../harness/page/bench.ts';
import type { ContourMap } from './contours.ts';

export async function run(map: ContourMap, firstFrameMs: number): Promise<void> {
  const { gl, cam } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl), counties: map.count, weeks: map.weeks, cells: map.nonzero } });
  emit({ check: 'all-counties-assigned', pass: map.assigned === map.count,
    detail: `${map.assigned} / ${map.count}` });
  const initial = { ...cam };
  await benchFrames(gl, 300, (i) => {
    const t = i / 299;
    cam.x = initial.x + 0.018 * Math.sin(t * Math.PI * 2);
    cam.y = initial.y + 0.012 * Math.sin(t * Math.PI * 4);
    cam.zoom = initial.zoom + 2 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    map.draw();
  });
  Object.assign(cam, initial);
  await benchFrames(gl, 60, () => map.draw(), { prefix: 'whole_' });
  const pixels = () => {
    map.draw();
    const out = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  const changed = (a: Uint8Array, b: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 16) if (a[i] !== b[i] || a[i + 3] !== b[i + 3]) n++;
    return n;
  };
  const bands = pixels();
  let visible = 0;
  for (let i = 0; i < bands.length; i += 4) if (bands[i + 3] > 0) visible++;
  emit({ check: 'visible-contour-bands', pass: visible > 1000, detail: `${visible} colored pixels` });
  map.setStyle('lines');
  const lines = pixels();
  emit({ check: 'style-changes-screen', pass: changed(bands, lines) > 1000,
    detail: `${changed(bands, lines)} changed samples` });
  map.setStyle('bands');
  map.setWeek(60);
  emit({ metric: 'week_update_ms', value: map.updateMs });
  const later = pixels();
  emit({ check: 'week-changes-screen', pass: changed(bands, later) > 1000,
    detail: `${changed(bands, later)} changed samples` });
  map.setWeek(30);
  map.setCellSize(20000);
  emit({ metric: 'cell_size_update_ms', value: map.updateMs });
  const finer = pixels();
  emit({ check: 'cell-size-changes-screen', pass: changed(bands, finer) > 1000,
    detail: `${changed(bands, finer)} changed samples` });
  map.setCellSize(60000);
  emit({ done: true });
}
