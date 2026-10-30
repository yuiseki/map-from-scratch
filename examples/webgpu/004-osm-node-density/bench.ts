// The ?bench branch of index.html: 04-osm-node-density's camera path, fixed
// views and checks, timed with WebGPU timestamps. main.ts imports this module
// only under ?bench.
import { emit, benchFramesGpu, zoomPath } from '../../../harness/page/bench.ts';
import type { DensityMap } from './density.ts';

// mounted: performance.now() right after mount() resolved, taken in main.ts
// before this file was imported, so loading the bench code is not counted.
export async function run(map: DensityMap, mounted: number): Promise<void> {
  const { device, cam } = map;
  device.lost.then((e) => emit({ error: `WebGPU device lost: ${e.message}` }));
  const t0 = performance.now();
  map.draw();
  await device.queue.onSubmittedWorkDone();
  emit({ metric: 'first_frame_ms', value: mounted + performance.now() - t0 });
  emit({ info: { gpu: map.gpu, points: map.points, timestamps: device.features.has('timestamp-query') } });

  // Grid coordinates of a lon/lat, as baked.
  const [w, s, e, n] = map.bbox;
  const k = Math.cos(((s + n) / 2) * Math.PI / 180), span = Math.max((e - w) * k, n - s);
  const grid = (lon: number, lat: number): [number, number] => [((lon - w) * k) / span, (n - lat) / span];

  // The timed frames go to an offscreen texture the size of the canvas.
  // Waiting for each frame yields the task, and a canvas texture is presented
  // between tasks (81 ms a frame on Xvfb, webgpu-003). 04's loop never yields,
  // so it never presents either.
  const [cx, cy] = grid(139.7016, 35.658);
  const path = zoomPath(300, { cx, cy, z0: 1, z1: 256, pan: 0.0005 });
  await benchFramesGpu(device, path.length, (i, ts) => {
    cam.x = path[i].cx; cam.y = path[i].cy; cam.zoom = path[i].zoom;
    map.draw(ts, true);
  });
  for (const [prefix, zoom] of [['whole_', 1], ['street_', 256]] as const) {
    cam.x = cx; cam.y = cy; cam.zoom = zoom;
    await benchFramesGpu(device, 60, (_, ts) => map.draw(ts, true), { prefix });
  }

  // Conservation: with everything in view, the counts add up to the points.
  cam.x = 0.5; cam.y = 0.5; cam.zoom = 0.9;
  map.draw();
  let counts = await map.readCounts();
  let sum = 0, max = 0;
  for (const c of counts) { sum += c; if (c > max) max = c; }
  emit({ info: { counted: sum, max_per_pixel: max } });
  emit({ check: 'count-conservation', pass: sum === map.points, detail: `${sum} of ${map.points}` });

  // Every pixel's count agrees with a CPU recount by the shader's f32
  // formula, around Shibuya station at 6x (crowded and empty pixels in
  // view). WGSL allows an inexact division and fused multiply-adds, so a
  // point within EPS of a pixel edge may land on either side: such a point
  // counts as "maybe" for every pixel it could land in, and each pixel must
  // hold its sure points plus at most its maybe points.
  cam.x = cx; cam.y = cy; cam.zoom = 6;
  map.draw();
  counts = await map.readCounts();
  const [W, H] = map.size();
  const bin = await fetch('../../../data/baked/04-osm-node-density/nodes.bin').then((r) => r.arrayBuffer());
  const dx = new Uint16Array(bin, 40, map.points), dy = new Uint16Array(bin, 40 + map.points * 2, map.points);
  const f = Math.fround, ccx = f(cam.x), ccy = f(cam.y), sc = f(map.scale()), hw = f(W * 0.5), hh = f(H * 0.5);
  const EPS = 1e-3;
  const sure = new Uint32Array(W * H), maybe = new Uint32Array(W * H);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  let edge = 0;
  for (let i = 0, x = 0, y = 0; i < map.points; i++) {
    x = (x + dx[i]) & 0xffff;
    y = (y + dy[i]) & 0xffff;
    const px = f(f(f(f(x) / 65535) - ccx) * sc + hw), py = f(f(f(f(y) / 65535) - ccy) * sc + hh);
    const xs = new Set([Math.floor(px - EPS), Math.floor(px + EPS)]), ys = new Set([Math.floor(py - EPS), Math.floor(py + EPS)]);
    if (xs.size === 1 && ys.size === 1) {
      if (inside(px, py)) sure[Math.floor(py) * W + Math.floor(px)]++;
      continue;
    }
    edge++;
    for (const cx of xs) for (const cy of ys) if (inside(cx, cy)) maybe[cy * W + cx]++;
  }
  let differ = 0, outside = 0;
  for (let i = 0; i < sure.length; i++) {
    if (counts[i] !== sure[i]) differ++;
    if (counts[i] < sure[i] || counts[i] > sure[i] + maybe[i]) outside++;
  }
  emit({ info: { pixels_differing_from_cpu: differ, points_near_an_edge: edge } });
  emit({ check: 'counts-match-cpu', pass: outside === 0, detail: `${outside} of ${W * H} pixels outside the CPU bounds; ${differ} differ from the sure count; ${edge} points within ${EPS} px of an edge` });

  // What reaches the screen: around Shibuya station the colour must not be
  // the empty background, and somewhere it must reach the bright end.
  const shown = await map.readScreen();
  const mid = ((H >> 1) * W + (W >> 1)) * 4;
  let brightest = 0;
  for (let i = 0; i < shown.length; i += 4) brightest = Math.max(brightest, shown[i + 1]);
  emit({ info: { centre_rgb: [...shown.subarray(mid, mid + 3)].join(','), brightest_green: brightest } });
  emit({ check: 'shibuya-not-empty', pass: !(shown[mid] < 20 && shown[mid + 1] < 20), detail: [...shown.subarray(mid, mid + 3)].join(',') });
  emit({ check: 'ramp-reaches-bright', pass: brightest >= 200, detail: `max green ${brightest}` });
  emit({ done: true });
}
