import { benchFrames, emit, glRenderer, zoomPath } from '../../../../harness/page/bench.ts';
import { projectEqualEarth } from './polygons.ts';
import type { PopulationMap } from './renderer.ts';

function sample(gl: WebGL2RenderingContext, x: number, y: number): number[] {
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), gl.canvas.height - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [...data];
}
function rgbDistance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export async function run(map: PopulationMap): Promise<void> {
  const { gl, state, stats } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  map.draw(); sample(gl, 0, 0);
  emit({ metric: 'first_frame_ms', value: performance.now() - map.startedAt });
  emit({ metric: 'joined_country_count', value: stats.countriesWithValues });
  emit({ metric: 'polygon_count', value: stats.polygons });
  emit({ metric: 'no_data_polygon_count', value: stats.countriesWithoutValues });
  emit({ info: { gpu: glRenderer(gl), joined_countries: stats.countriesWithValues, no_data_features: stats.countriesWithoutValues, polygons: stats.polygons, vertices: map.vertexCount, triangles: map.triangleIndexCount / 3, border_segments: map.borderCount } });
  emit({ check: 'joined-country-count', pass: stats.countriesWithValues === 213 && stats.unmatchedCodes.length === 4, detail: `${stats.countriesWithValues}/217 joined; unmatched ${stats.unmatchedCodes.join(', ')}` });
  emit({ check: 'population-colors', pass: stats.colorClasses >= 4 && stats.minimum > 0 && stats.maximum > stats.minimum, detail: `${stats.colorClasses} classes; ${stats.minimum}–${stats.maximum}` });
  emit({ check: 'missing-data', pass: stats.countriesWithoutValues > 0, detail: `${stats.countriesWithoutValues} boundary features have no population value` });

  const [cx, cy] = projectEqualEarth(78, 20);
  const path = zoomPath(80, { cx, cy, z0: 0.65, z1: 5, pan: 0.12 });
  await benchFrames(gl, path.length, (i) => { state.centerX = path[i].cx; state.centerY = path[i].cy; state.zoom = path[i].zoom; map.draw(); });
  state.centerX = 0; state.centerY = 0; state.zoom = 1; map.draw();
  const indiaAt = map.screenPoint(78, 20), antarcticaAt = map.screenPoint(0, -80), oceanAt = map.screenPoint(-140, -30);
  const india = sample(gl, ...indiaAt), antarctica = sample(gl, ...antarcticaAt), ocean = sample(gl, ...oceanAt);
  const populatedDelta = rgbDistance(india, ocean), missingDelta = rgbDistance(antarctica, ocean);
  emit({ check: 'polygons-visible', pass: populatedDelta > 20 && missingDelta > 20, detail: `India/ocean Δ=${populatedDelta.toFixed(1)}, Antarctica/ocean Δ=${missingDelta.toFixed(1)}` });
  emit({ done: true });
}
