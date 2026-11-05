import { benchFrames, emit, glRenderer, zoomPath } from '../../../../harness/page/bench.ts';
import { projectEarth, projectPoint } from './points.ts';
import type { EarthquakeMap } from './renderer.ts';

function pixel(gl: WebGL2RenderingContext, x: number, y: number): number[] {
  const data = new Uint8Array(4);
  gl.readPixels(Math.round(x), gl.canvas.height - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return [...data];
}

function neighborhood(gl: WebGL2RenderingContext, x: number, y: number, radius: number): number[][] {
  const found: number[][] = [];
  for (let py = y - radius; py <= y + radius; py++) {
    for (let px = x - radius; px <= x + radius; px++) found.push(pixel(gl, px, py));
  }
  return found;
}

export async function run(map: EarthquakeMap): Promise<void> {
  const { gl, state } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  map.draw();
  pixel(gl, 1, 1);
  emit({ metric: 'first_frame_ms', value: performance.now() - map.startedAt });
  emit({ metric: 'point_count', value: map.pointCount });
  emit({ info: { gpu: glRenderer(gl), points: map.pointCount, land_vertices: map.vertexCount, land_indices: map.indexCount } });

  const [cx, cy] = projectEarth(95.9363, 22.011);
  const path = zoomPath(80, { cx, cy, z0: 0.65, z1: 5, pan: 0.12 });
  await benchFrames(gl, path.length, (i) => {
    state.centerX = path[i].cx;
    state.centerY = path[i].cy;
    state.zoom = path[i].zoom;
    map.draw();
  });

  state.centerX = 0; state.centerY = 0; state.zoom = 1;
  map.draw();
  const tokyo = projectPoint(139.7, 35.7, gl.canvas.width, gl.canvas.height);
  const pacific = projectPoint(-25, 0, gl.canvas.width, gl.canvas.height);
  const landPixel = pixel(gl, tokyo[0], tokyo[1]);
  const seaPixel = pixel(gl, pacific[0], pacific[1]);
  const landDelta = Math.hypot(landPixel[0] - seaPixel[0], landPixel[1] - seaPixel[1], landPixel[2] - seaPixel[2]);
  emit({ check: 'land-visible', pass: landDelta > 20, detail: `land=${landPixel.join(',')} sea=${seaPixel.join(',')} delta=${landDelta.toFixed(1)}` });

  const epicenter = map.screenPoint(95.9363, 22.011);
  const red = neighborhood(gl, Math.round(epicenter[0]), Math.round(epicenter[1]), 7)
    .filter(([r, g, b]) => r > g + 40 && r > b + 40);
  emit({ check: 'myanmar-earthquake-visible', pass: red.length > 80, detail: `${red.length} red pixels near M7.7 epicenter` });
  emit({ check: 'point-count', pass: map.pointCount === 8502, detail: `uploaded ${map.pointCount} / expected 8502` });
  emit({ done: true });
}
