// The ?bench branch of index.html: the camera path, the two fixed views and
// the checks. main.ts imports this module only under ?bench.
import { emit, glRenderer, benchFrames, zoomPath } from '../../harness/page/bench.ts';
import type { DensityMap } from './density.ts';

// mounted: performance.now() right after mount() resolved, taken in main.ts
// before this file was imported, so loading the bench code is not counted.
export async function run(map: DensityMap, mounted: number): Promise<void> {
  const { gl, cam } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webgl context lost' }));
  const t0 = performance.now();
  map.draw();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  emit({ metric: 'first_frame_ms', value: mounted + performance.now() - t0 });
  emit({ info: { gpu: glRenderer(gl), points: map.points } });

  // Grid coordinates of a lon/lat, as baked.
  const [w, s, e, n] = map.bbox;
  const k = Math.cos(((s + n) / 2) * Math.PI / 180), span = Math.max((e - w) * k, n - s);
  const grid = (lon: number, lat: number): [number, number] => [((lon - w) * k) / span, (n - lat) / span];

  // From all 23 wards down to a few streets around Shibuya station and back.
  const [cx, cy] = grid(139.7016, 35.658);
  const path = zoomPath(300, { cx, cy, z0: 1, z1: 256, pan: 0.0005 });
  await benchFrames(gl, path.length, (i) => {
    cam.x = path[i].cx; cam.y = path[i].cy; cam.zoom = path[i].zoom;
    map.draw();
  });

  // The two ends of the path held still: every point lands in a pixel (and
  // blends, up to hundreds per pixel), or almost all are clipped.
  for (const [prefix, zoom] of [['whole_', 1], ['street_', 256]] as const) {
    cam.x = cx; cam.y = cy; cam.zoom = zoom;
    await benchFrames(gl, 60, () => map.draw(), { prefix });
  }

  // Conservation: with everything in view, the counts add up to the points.
  cam.x = 0.5; cam.y = 0.5; cam.zoom = 0.9;
  map.draw();
  const t = map.countTarget();
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  const px = new Float32Array(t.w * t.h * 4);
  gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let sum = 0, max = 0;
  for (let i = 0; i < px.length; i += 4) { sum += px[i]; max = Math.max(max, px[i]); }
  emit({ info: { counted: sum, max_per_pixel: max } });
  emit({ check: 'count-conservation', pass: sum === map.points, detail: `${sum} of ${map.points}` });

  // A point dropped and a point invented elsewhere keep the sum, so each
  // pixel is also compared with a CPU recount of the same view. WebGL snaps
  // a point to a subpixel grid (1/256 px with 8 bits), so a point within EPS
  // of a pixel edge may land on either side: it counts as "maybe" for every
  // pixel it could land in, and each pixel must hold its sure points plus at
  // most its maybe points. Rows of the count target run bottom up.
  {
    const W = t.w, H = t.h, EPS = 1 / 128;
    const bin = await fetch('../../data/baked/04-osm-node-density/nodes.bin').then((r) => r.arrayBuffer());
    const dx = new Uint16Array(bin, 40, map.points), dy = new Uint16Array(bin, 40 + map.points * 2, map.points);
    const sc = Math.min(W, H) * cam.zoom;
    const sure = new Uint32Array(W * H), maybe = new Uint32Array(W * H);
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
    for (let i = 0, x = 0, y = 0; i < map.points; i++) {
      x = (x + dx[i]) & 0xffff;
      y = (y + dy[i]) & 0xffff;
      const sx = (x / 65535 - cam.x) * sc + W / 2, sy = H / 2 - (y / 65535 - cam.y) * sc;
      const xs = new Set([Math.floor(sx - EPS), Math.floor(sx + EPS)]), ys = new Set([Math.floor(sy - EPS), Math.floor(sy + EPS)]);
      if (xs.size === 1 && ys.size === 1) { if (inside(sx, sy)) sure[Math.floor(sy) * W + Math.floor(sx)]++; continue; }
      for (const ex of xs) for (const ey of ys) if (inside(ex, ey)) maybe[ey * W + ex]++;
    }
    let outside = 0;
    for (let i = 0; i < sure.length; i++) if (px[i * 4] < sure[i] || px[i * 4] > sure[i] + maybe[i]) outside++;
    emit({ check: 'counts-match-cpu', pass: outside === 0, detail: `${outside} of ${W * H} pixels outside the CPU bounds` });
  }

  // What reaches the screen: around Shibuya station the colour must not be
  // the empty background, and somewhere it must reach the bright end.
  cam.x = cx; cam.y = cy; cam.zoom = 6;
  map.draw();
  const shown = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, shown);
  const mid = ((gl.canvas.height >> 1) * gl.canvas.width + (gl.canvas.width >> 1)) * 4;
  let brightest = 0;
  for (let i = 0; i < shown.length; i += 4) brightest = Math.max(brightest, shown[i + 1]);
  emit({ info: { centre_rgb: [...shown.subarray(mid, mid + 3)].join(','), brightest_green: brightest } });
  emit({ check: 'shibuya-not-empty', pass: !(shown[mid] < 20 && shown[mid + 1] < 20), detail: [...shown.subarray(mid, mid + 3)].join(',') });
  emit({ check: 'ramp-reaches-bright', pass: brightest >= 200, detail: `max green ${brightest}` });
  emit({ done: true });
}
