import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.ts';
import type { Heatmap } from './heatmap.ts';

export async function run(map: Heatmap, firstFrameMs: number): Promise<void> {
  const { gl, cam } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  emit({ metric: 'first_frame_ms', value: firstFrameMs });
  emit({ info: { gpu: glRenderer(gl), points: map.points, weight: map.totalWeight } });

  const [west, north, east, south] = map.bounds;
  const allZoom = Math.log2(Math.min(gl.canvas.width / (east - west), gl.canvas.height / (south - north)) * 0.9 / 512);
  const initial = { x: cam.x, y: cam.y, zoom: cam.zoom };
  await benchFrames(gl, 300, (i) => {
    const phase = i / 299;
    const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    cam.x = initial.x + (0.5 - initial.x) * t;
    cam.y = initial.y + (0.5 - initial.y) * t;
    cam.zoom = initial.zoom + (allZoom - initial.zoom) * t;
    map.draw();
  });
  cam.x = 0.5; cam.y = 0.5; cam.zoom = allZoom;
  await benchFrames(gl, 60, () => map.draw(), { prefix: 'whole_' });

  cam.x = initial.x; cam.y = initial.y; cam.zoom = initial.zoom;
  map.draw();
  const pixels = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let colored = 0, hot = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 1] > 50) colored++;
    if (pixels[i] > 170 && pixels[i + 1] > 85) hot++;
  }
  emit({ check: 'visible-heatmap', pass: colored > 1000 && hot > 10, detail: `colored=${colored}, hot=${hot}` });

  map.setRadius(10);
  const small = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, small);
  map.setRadius(50);
  const large = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, large);
  let changed = 0;
  for (let i = 0; i < small.length; i += 16) if (small[i] !== large[i]) changed++;
  emit({ check: 'radius-changes-screen', pass: changed > 1000, detail: `${changed} sampled pixels changed` });

  map.setRadius(30);
  map.setIntensity(2);
  const strong = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, strong);
  changed = 0;
  for (let i = 0; i < pixels.length; i += 16) if (pixels[i] !== strong[i]) changed++;
  emit({ check: 'intensity-changes-screen', pass: changed > 1000, detail: `${changed} sampled pixels changed` });
  map.setIntensity(1);

  map.setThreshold(0.2);
  const filtered = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, filtered);
  changed = 0;
  for (let i = 0; i < pixels.length; i += 16) if (pixels[i] !== filtered[i]) changed++;
  emit({ check: 'threshold-changes-screen', pass: changed > 1000, detail: `${changed} sampled pixels changed` });
  map.setThreshold(0.03);
  emit({ done: true });
}
