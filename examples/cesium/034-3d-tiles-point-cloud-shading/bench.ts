// The ?bench branch: first frame, an orbit with EDL on, a close view at full
// detail, then checks that read the canvas back. main.ts imports this file
// only under ?bench.
import { emit, benchFrames, glRenderer, readBack } from '../../../harness/page/bench.ts';
import { viewOf, project, type Orbit } from './camera.ts';
import { decodeNode } from './format.ts';
import { BACKGROUND } from './render.ts';
import type { App } from './main.ts';

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
// The close view: low over Tokyo Station with the maximum screen space
// error at 2, so the z18 leaves (0.5 m spacing) are drawn.
const CLOSE: Partial<Orbit> = { pitch: 40, distance: 220 };
const CLOSE_SSE = 2;
// Straight down over the station for the EDL check: flat roofs and streets
// have one eye depth each, so only their edges can darken.
const TOP: Partial<Orbit> = { heading: 0, pitch: 90, distance: 450 };
const BG = BACKGROUND.map((v) => Math.round(v * 255));

export async function run(app: App): Promise<void> {
  const { gl, canvas, orbit } = app;
  canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));
  emit({ info: { gpu: glRenderer(gl), dpr: devicePixelRatio } });
  const px = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const settle = async () => { app.render(); while (!app.idle()) { await nextFrame(); app.render(); } };
  const ctx = { canvas } as unknown as CanvasRenderingContext2D;
  const W = () => canvas.width, H = () => canvas.height;
  const shot = () => { app.render(); return readBack(ctx, 0, 0, W(), H()).data; };
  const isBg = (s: Uint8ClampedArray, i: number) => Math.abs(s[i] - BG[0]) <= 2 && Math.abs(s[i + 1] - BG[1]) <= 2 && Math.abs(s[i + 2] - BG[2]) <= 2;
  const lum = (s: Uint8ClampedArray, i: number) => 0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2];
  const control = (id: string) => document.getElementById(id) as HTMLInputElement;
  const setControl = (id: string, value: number | boolean) => {
    const el = control(id);
    if (typeof value === 'boolean') el.checked = value; else el.value = String(value);
    el.dispatchEvent(new Event('input'));
  };

  // First frame: from navigation start until the opening view is drawn with
  // every node it selects loaded (the four z16 roots at the default SSE),
  // and the GPU has finished.
  while (!app.tileset() || !app.idle()) await nextFrame();
  app.render(); finish();
  emit({ metric: 'first_frame_ms', value: performance.now() });
  emit({ metric: 'opening_bytes', value: app.stats.bytes });
  emit({ metric: 'opening_requests', value: app.stats.requests });
  emit({ metric: 'opening_points', value: app.stats.points });
  if (app.error()) emit({ error: app.error() });

  // Orbit with EDL on: a full turn while pitching and closing in to half
  // the distance. Every node the path selects is loaded first, so the timed
  // frames draw and do not fetch.
  const home = { ...orbit };
  const path = Array.from({ length: 300 }, (_, i) => {
    const u = i / 299, w = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    return { heading: (home.heading + 360 * u) % 360, pitch: home.pitch + 12 * Math.sin(2 * Math.PI * u), distance: home.distance * (1 - 0.55 * w) };
  });
  for (let i = 0; i < path.length; i += 10) { Object.assign(orbit, home, path[i]); await settle(); }
  const orbitPoints: number[] = [];
  await benchFrames(gl, path.length, (i) => { Object.assign(orbit, home, path[i]); app.render(); orbitPoints.push(app.stats.points); });
  emit({ metric: 'points_drawn', values: orbitPoints });

  // Close and at full detail: the most points and the largest splats.
  Object.assign(orbit, home, CLOSE);
  app.lod.maximumScreenSpaceError = CLOSE_SSE;
  await settle();
  const closePoints: number[] = [];
  await benchFrames(gl, 60, () => { app.render(); closePoints.push(app.stats.points); }, { prefix: 'close_' });
  emit({ metric: 'close_points_drawn', values: closePoints });

  // Checks read the canvas from here on.
  // 1. The controls: each one, moved through its own element, changes the
  //    picture on the very next frame. Close view, leaves drawn, so the base
  //    resolution (used only by leaves) has something to act on.
  control('mse').value = String(CLOSE_SSE);
  const trials: [string, number | boolean, number | boolean][] = [
    ['maxatt', 4, 0], ['baseres', 0.3, 0], ['ges', 0.05, 1], ['mse', 1, CLOSE_SSE],
    ['edls', 4, 1], ['edlr', 3, 1], ['edl', false, true], ['att', false, true],
  ];
  const redraw: number[] = [], results: string[] = [];
  let allChanged = true;
  for (const [id, value, back] of trials) {
    await nextFrame();
    const before = shot();
    setControl(id, value);
    const t0 = performance.now();
    await nextFrame();               // the page's draw runs before this callback
    const after = readBack(ctx, 0, 0, W(), H()).data;
    finish();
    redraw.push(performance.now() - t0);
    let changed = 0;
    for (let i = 0; i < after.length; i += 4) {
      if (Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]) > 12) changed++;
    }
    const share = changed / (W() * H());
    if (share < 0.005) allChanged = false;
    results.push(`${id}=${value}: ${(100 * share).toFixed(1)}%`);
    setControl(id, back);
    await nextFrame();
  }
  emit({ metric: 'control_redraw_ms', values: redraw });
  emit({ check: 'controls-redraw-next-frame', pass: allChanged, detail: `pixels changed one frame after each control: ${results.join(', ')}` });
  app.lod.maximumScreenSpaceError = 16;
  control('mse').value = '16';

  // 2. The opening view is covered by points in many colours.
  Object.assign(orbit, home);
  await settle();
  let s = shot();
  let covered = 0;
  const colours = new Set<number>();
  for (let i = 0; i < s.length; i += 4) {
    if (isBg(s, i)) continue;
    covered++;
    colours.add((s[i] >> 4) << 8 | (s[i + 1] >> 4) << 4 | s[i + 2] >> 4);
  }
  const share = covered / (W() * H());
  emit({ check: 'opening-view-drawn', pass: share >= 0.6 && colours.size >= 300, detail: `${(100 * share).toFixed(1)}% of pixels covered, ${colours.size} distinct 4-bit colours` });

  // 3. Attenuation fills the gaps between points. Lower middle of the
  //    opening view, which lies inside the data square.
  const holes = (img: Uint8ClampedArray) => {
    let n = 0, total = 0;
    for (let y = Math.floor(H() * 0.5); y < Math.floor(H() * 0.95); y++) for (let x = Math.floor(W() * 0.25); x < Math.floor(W() * 0.75); x++) {
      total++; if (isBg(img, (y * W() + x) * 4)) n++;
    }
    return { n, total };
  };
  const on = holes(s);
  setControl('att', false);
  const off = holes(shot());
  setControl('att', true);
  emit({
    check: 'attenuation-fills-holes', pass: off.n >= 0.05 * off.total && on.n <= 0.5 * off.n,
    detail: `background pixels in the lower middle: ${on.n} with attenuation, ${off.n} without (${off.total} pixels)`,
  });

  // 4. EDL darkens depth edges and leaves flat surfaces alone. Edges and
  //    flats come from the data, not from the renderer: a height map of the
  //    drawn nodes' points projected with the same camera.
  Object.assign(orbit, home, TOP);
  await settle();
  setControl('edl', false);
  const plain = shot();
  setControl('edl', true);
  const lit = shot();
  const w = W(), h = H(), height = new Float32Array(w * h).fill(-Infinity);
  const view = viewOf(orbit, w, h);
  for (const i of app.drawn()) {
    const node = app.tileset()!.nodes[i], bytes = app.kept.get(i);
    if (!bytes) continue;
    const { q } = decodeNode(bytes, node.count);
    for (let k = 0; k < node.count; k++) {
      const p: [number, number, number] = [0, 1, 2].map((a) => node.min[a] + q[k * 3 + a] / 65535 * (node.max[a] - node.min[a])) as [number, number, number];
      const [sx, sy] = project(view, p, w, h);
      const x = Math.floor(sx), y = Math.floor(sy);
      if (x >= 0 && y >= 0 && x < w && y < h && p[2] > height[y * w + x]) height[y * w + x] = p[2];
    }
  }
  const edge: number[] = [], flat: number[] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const c = height[y * w + x], k = (y * w + x) * 4;
    if (c === -Infinity || isBg(plain, k) || lum(plain, k) < 20) continue;
    let higher = false, present = 0, uneven = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const n = height[(y + dy) * w + x + dx];
      if (n === -Infinity) continue;
      present++;
      if (n >= c + 3) higher = true;
      if (Math.abs(n - c) > 0.3) uneven = true;
    }
    const ratio = lum(lit, k) / lum(plain, k);
    if (higher) edge.push(ratio); else if (!uneven && present >= 6) flat.push(ratio);
  }
  const median = (a: number[]) => a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : NaN;
  const me = median(edge), mf = median(flat);
  emit({
    check: 'edl-darkens-depth-edges', pass: edge.length >= 200 && flat.length >= 200 && me <= 0.8 && mf >= 0.95,
    detail: `EDL on / off luminance, median: ${me.toFixed(3)} at ${edge.length} pixels beside something 3 m higher, ${mf.toFixed(3)} at ${flat.length} pixels on flat ground or roofs`,
  });

  // 5. Drag and wheel move the camera and the picture.
  Object.assign(orbit, home);
  await settle();
  s = shot();
  const heading0 = orbit.heading, distance0 = orbit.distance;
  const pointer = (type: string, x: number) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 300, button: 0, bubbles: true }));
  pointer('pointerdown', 400); pointer('pointermove', 480); pointer('pointerup', 480);
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  await nextFrame();
  const moved = readBack(ctx, 0, 0, W(), H()).data;
  let diff = 0;
  for (let i = 0; i < moved.length; i += 4) if (Math.abs(moved[i] - s[i]) + Math.abs(moved[i + 1] - s[i + 1]) + Math.abs(moved[i + 2] - s[i + 2]) > 12) diff++;
  emit({
    check: 'drag-and-wheel-move-view',
    pass: Math.abs(orbit.heading - heading0 - 24) < 1e-6 && orbit.distance < distance0 && diff > 0.05 * W() * H(),
    detail: `heading ${heading0} -> ${orbit.heading}, distance ${distance0.toFixed(0)} -> ${orbit.distance.toFixed(0)}, ${(100 * diff / (W() * H())).toFixed(1)}% of pixels changed`,
  });

  // The opening view for the screenshot.
  Object.assign(orbit, home);
  await settle();
  emit({ metric: 'transfer_bytes_page', value: app.stats.bytes });
  if (app.error()) emit({ error: app.error() });
  emit({ done: true });
}
