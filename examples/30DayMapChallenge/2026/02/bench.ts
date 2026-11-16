import { benchFrames, emit, glRenderer, zoomPath } from '../../../../harness/page/bench.ts';
import { projectEarth, splitAntimeridian } from './tracks.ts';
import type { StormMap } from './renderer.ts';

function pixels(gl: WebGL2RenderingContext): Uint8Array {
  const out = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

export async function run(map: StormMap): Promise<void> {
  const { gl, state, stats } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  map.draw(); pixels(gl);
  emit({ metric: 'first_frame_ms', value: performance.now() - map.startedAt });
  emit({ metric: 'segment_count', value: map.segmentCount });
  emit({ metric: 'basin_count', value: Object.keys(stats.basinSegments).length });
  emit({ info: { gpu: glRenderer(gl), segments: map.segmentCount, observations: stats.observations, storms: stats.storms, land_vertices: map.vertexCount, land_indices: map.indexCount } });
  emit({ check: 'source-counts', pass: stats.observations === 311935 && stats.storms === 5010 && map.segmentCount === stats.segments, detail: `${stats.observations} observations; ${stats.storms} SID; ${map.segmentCount} segments` });
  const crossing = splitAntimeridian([170, 10], [-170, 20], 'WP');
  emit({ check: 'antimeridian', pass: crossing.length === 2 && crossing[0].b[0] === 180 && crossing[1].a[0] === -180, detail: `${crossing.length} segments split at both map edges` });
  emit({ check: 'basin-class', pass: Object.keys(stats.basinSegments).length === 7 && Object.values(stats.basinSegments).every(Number.isInteger), detail: JSON.stringify(stats.basinSegments) });

  const [cx, cy] = projectEarth(150, 15);
  const path = zoomPath(240, { cx, cy, z0: 0.7, z1: 3.8, pan: 0.14 });
  await benchFrames(gl, path.length, (i) => { state.centerX = path[i].cx; state.centerY = path[i].cy; state.zoom = path[i].zoom; map.draw(); });
  state.centerX = 0; state.centerY = 0; state.zoom = 1; map.draw();
  const image = pixels(gl);
  let bright = 0;
  for (let i = 0; i < image.length; i += 4) if (image[i] + image[i + 1] + image[i + 2] > 205) bright++;
  emit({ check: 'tracks-visible', pass: bright > 1000, detail: `${bright} pixels brighter than land/background threshold` });
  emit({ done: true });
}
