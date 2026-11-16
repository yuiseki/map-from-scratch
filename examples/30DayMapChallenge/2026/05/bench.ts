import { benchFrames, emit, glRenderer } from '../../../../harness/page/bench.ts';
import { cameraViewProjection, orbitByDrag, zoomCamera } from './camera.ts';
import type { FujiTerrain } from './renderer.ts';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function run(map: FujiTerrain): Promise<void> {
  const { gl, stats } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  map.draw();
  const pixels = map.readPixels(), firstFrame = performance.now() - map.startedAt;
  const firstGlError = gl.getError();
  const contextDetails = document.querySelectorAll('[data-context]').length;
  emit({ metric: 'first_frame_ms', value: firstFrame });
  emit({ metric: 'elevation_cell_count', value: map.width * map.height });
  emit({ metric: 'terrain_triangle_count', value: map.triangleCount });
  emit({ metric: 'terrain_pixel_count', value: pixels.terrainPixels });
  emit({ metric: 'context_detail_count', value: contextDetails });
  emit({ info: { gpu: glRenderer(gl), grid: `${map.width}x${map.height}`, cells: stats.cells, triangles: map.triangleCount, elevation_m: [stats.minimumMean, stats.maximumMean], source_pixels: stats.validSourcePixels, image_colors: pixels.colorCount, image_terrain_pixels: pixels.terrainPixels, first_gl_error: firstGlError, init_gl_errors: map.glErrors } });
  emit({ check: 'source-grid', pass: map.width === 256 && map.height === 256 && stats.cells === 65536 && stats.validSourcePixels === 6553600, detail: `${stats.cells} cells; ${stats.validSourcePixels} valid source pixels` });
  emit({ check: 'terrain-relief', pass: stats.minimumMean > 230 && stats.minimumMean < 250 && stats.maximumMean > 3700 && stats.maximumMean < 3800 && pixels.terrainPixels > 30000 && pixels.colorCount > 100, detail: `${stats.minimumMean.toFixed(1)}–${stats.maximumMean.toFixed(1)} m; ${pixels.terrainPixels} terrain pixels; ${pixels.colorCount} quantized colors` });
  emit({ check: 'context-disclosures', pass: contextDetails >= 2 && document.body.innerText.includes('公式製品ではありません'), detail: `${contextDetails} source and vertical-scale disclosures; non-official notice visible` });

  const original = { ...map.state };
  await benchFrames(gl, 80, (i) => {
    const next = orbitByDrag(map.state, 1.8, Math.sin(i / 9) * 0.35);
    Object.assign(map.state, next);
    if (i % 5 === 0) Object.assign(map.state, zoomCamera(map.state, i % 10 === 0 ? -1 : 1));
    map.draw();
  });
  const matricesFinite = [0.5, 1, 2].every((aspect) => [...cameraViewProjection(map.state, aspect)].every(Number.isFinite));
  Object.assign(map.state, original); map.draw();
  const cameraGlError = gl.getError();
  emit({ check: 'camera-controls', pass: matricesFinite && cameraGlError === gl.NO_ERROR && firstGlError === gl.NO_ERROR && map.glErrors.length === 0, detail: `80 camera frames rendered; matrices finite; initial GL ${firstGlError}; initialization ${map.glErrors.join(',') || 'clean'}; camera GL ${cameraGlError}` });

  const canvas = gl.canvas as HTMLCanvasElement;
  const oldWidth = canvas.style.width, oldHeight = canvas.style.height;
  let responsiveSizes = 0;
  for (const [width, height] of [['84vw', '78vh'], ['67vw', '64vh']]) {
    canvas.style.width = width; canvas.style.height = height;
    await nextFrame(); await nextFrame();
    if (canvas.width === Math.round(canvas.clientWidth * devicePixelRatio) && canvas.height === Math.round(canvas.clientHeight * devicePixelRatio) && canvas.width > 0 && canvas.height > 0) responsiveSizes++;
  }
  canvas.style.width = oldWidth; canvas.style.height = oldHeight; await nextFrame(); await nextFrame();
  emit({ metric: 'responsive_size_count', value: responsiveSizes });
  emit({ check: 'resize-responsive', pass: responsiveSizes === 2, detail: `${responsiveSizes}/2 canvas sizes followed CSS resize` });
  map.draw(); emit({ done: true });
}
