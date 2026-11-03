// The ?bench branch of index.html. It waits for the 5x5 visible tiles around
// Kaminarimon, then times the renderer alone on them (an orbit and two fixed
// views) and checks what reached the screen against a CPU splat of the
// centre tile. main.ts imports this file only under ?bench.
//
// measure() is also the bench of webgpu/005-taito-point-cloud: the same
// tiles, camera path and checks, so the two renderers differ only in the
// graphics API. Each passes its own drawing, timing and read-back as an Io.
import { emit, benchFrames, glRenderer } from '../../harness/page/bench.ts';
import { decodePcpng, type Cloud, type Origin } from './decode.ts';
import type { Camera, Mesh } from './render.ts';

const SOURCE = 'https://tiles.gsj.jp/tiles/pcpng/mixed/tiles';
// The clear colour of both renderers (0.055, 0.085, 0.11) as bytes.
const BACKGROUND = [14, 22, 28];
// Fixed views over the same tiles: straight down from 1.4 km with every
// visible tile on screen, and close and low, where points are 8 px and
// overdraw is highest.
const TOP = { yaw: 0, pitch: 90, distance: 1400 };
const CLOSE = { yaw: 22, pitch: 35, distance: 150 };

export interface VisibleTile<M> { z: number; x: number; y: number; mesh: M | null; failed: boolean }
export interface Io<M> {
  camera: Camera;
  origin: Origin;
  info: Record<string, unknown>;
  ready(): boolean;                    // every visible tile loaded or 404
  freeze(): void;                      // the page stops drawing and requesting
  idle(): boolean;                     // no request in flight
  visible(): VisibleTile<M>[];         // centre first
  error(): string;
  size(): [number, number];            // drawing buffer in device pixels
  draw(meshes: M[]): void;             // the camera onto the canvas
  finish(): Promise<void>;             // waits until the GPU is done
  frames(steps: number, set: (i: number) => void, meshes: M[], prefix: string): Promise<void>;
  screen(meshes: M[]): Promise<Uint8Array>;   // draws, reads RGBA back, top row first
}

// The camera basis of render.ts, written again for the CPU reference.
function basis(camera: Camera, W: number, H: number) {
  const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
  const h = Math.cos(pitch), v = Math.sin(pitch), tanY = Math.tan(Math.PI / 6);
  return {
    eye: [camera.x + Math.sin(yaw) * h * camera.distance, camera.y - Math.cos(yaw) * h * camera.distance, 50 + v * camera.distance],
    forward: [-Math.sin(yaw) * h, Math.cos(yaw) * h, -v],
    right: [Math.cos(yaw), Math.sin(yaw), 0],
    up: [-Math.sin(yaw) * v, Math.cos(yaw) * v, h],
    tanX: tanY * W / H, tanY,
    near: Math.max(0.5, camera.distance / 2000), far: Math.max(10000, camera.distance * 8),
  };
}

// Each point as the disc both renderers draw, nearest wins, sampled at pixel
// centres (no antialiasing).
function splat(cloud: Cloud, camera: Camera, W: number, H: number) {
  const b = basis(camera, W, H), p = cloud.positions;
  const size = camera.size * Math.min(2, devicePixelRatio || 1);
  const color = new Uint8Array(W * H * 3), depth = new Float32Array(W * H).fill(Infinity);
  for (let i = 0; i < cloud.count; i++) {
    const dx = p[i * 3] - b.eye[0], dy = p[i * 3 + 1] - b.eye[1], dz = p[i * 3 + 2] - b.eye[2];
    const d = dx * b.forward[0] + dy * b.forward[1] + dz * b.forward[2];
    if (d <= b.near || d >= b.far) continue;
    const sx = ((dx * b.right[0] + dy * b.right[1]) / b.tanX / d + 1) * W / 2;
    const sy = (1 - (dx * b.up[0] + dy * b.up[1] + dz * b.up[2]) / b.tanY / d) * H / 2;
    const r = Math.min(8, Math.max(1.2, size * 220 / Math.max(d, 1))) / 2;
    for (let y = Math.max(0, Math.floor(sy - r)); y <= Math.min(H - 1, Math.ceil(sy + r)); y++) {
      for (let x = Math.max(0, Math.floor(sx - r)); x <= Math.min(W - 1, Math.ceil(sx + r)); x++) {
        const k = y * W + x;
        if ((x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2 > r * r || d >= depth[k]) continue;
        depth[k] = d;
        color[k * 3] = cloud.colors[i * 3]; color[k * 3 + 1] = cloud.colors[i * 3 + 1]; color[k * 3 + 2] = cloud.colors[i * 3 + 2];
      }
    }
  }
  return { color, depth };
}

async function fetchCloud(t: { z: number; x: number; y: number }, origin: Origin): Promise<Cloud> {
  const blob = await (await fetch(`${SOURCE}/${t.z}/${t.x}/${t.y}.webp`)).blob();
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return decodePcpng(image.data, image.width, image.height, origin);
}

const isBackground = (s: Uint8Array, i: number) =>
  Math.abs(s[i] - BACKGROUND[0]) <= 2 && Math.abs(s[i + 1] - BACKGROUND[1]) <= 2 && Math.abs(s[i + 2] - BACKGROUND[2]) <= 2;

export async function measure<M>(io: Io<M>): Promise<void> {
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  while (!io.ready()) await nextFrame();
  const tiles = io.visible();
  const meshes = tiles.filter((t) => t.mesh).map((t) => t.mesh!);
  io.draw(meshes);
  await io.finish();
  // From navigation start: renderer set-up, 25 tile fetches from GSJ,
  // decoding, upload and the first frame with all of them drawn.
  emit({ metric: 'first_frame_ms', value: performance.now() });
  // From here the bench owns the camera. Prefetches already in flight finish
  // (and upload) before the timed frames, none start after.
  io.freeze();
  while (!io.idle()) await nextFrame();
  const failed = tiles.filter((t) => t.failed).length;
  emit({ info: { ...io.info, tiles: tiles.length, loaded: meshes.length, failed } });
  emit({
    check: 'view-tiles-loaded', pass: tiles.length === 25 && meshes.length >= 20 && !io.error(),
    detail: `${meshes.length} of ${tiles.length} loaded, ${failed} failed${io.error() ? `: ${io.error()}` : ''}`,
  });

  // Timed frames first: no read-back has happened yet (pitfalls.md).
  const home = { ...io.camera };
  const path = Array.from({ length: 300 }, (_, i) => {
    const u = i / 299, w = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    return { yaw: (home.yaw + 360 * u) % 360, pitch: home.pitch + 18 * Math.sin(2 * Math.PI * u), distance: home.distance * (1 - 0.6 * w) };
  });
  await io.frames(path.length, (i) => Object.assign(io.camera, path[i]), meshes, '');
  for (const [prefix, view] of [['top_', TOP], ['close_', CLOSE]] as const) {
    Object.assign(io.camera, home, view);
    await io.frames(60, () => {}, meshes, prefix);
  }

  // The opening view is mostly covered by points, in many colours.
  const [W, H] = io.size();
  Object.assign(io.camera, home);
  const shot = await io.screen(meshes);
  const colours = new Set<number>();
  let covered = 0;
  for (let i = 0; i < W * H * 4; i += 4) {
    if (isBackground(shot, i)) continue;
    covered++;
    colours.add((shot[i] >> 4) << 8 | (shot[i + 1] >> 4) << 4 | shot[i + 2] >> 4);
  }
  emit({ check: 'screen-covered', pass: covered / (W * H) >= 0.5, detail: `${(100 * covered / (W * H)).toFixed(1)}% of pixels are not background` });
  emit({ check: 'colours-vary', pass: colours.size >= 300, detail: `${colours.size} distinct 4-bit colours` });

  // The centre tile alone, straight down with large points, against a CPU
  // splat of the same tile fetched and decoded again: position, height
  // (depth order) and colour of each point must reach the right pixels.
  const centre = tiles[0];
  if (centre.mesh) {
    Object.assign(io.camera, home, TOP, { size: 24 });
    const cloud = await fetchCloud(centre, io.origin);
    const ref = splat(cloud, io.camera, W, H);
    const got = await io.screen([centre.mesh]);
    let refPixels = 0, matched = 0, stray = 0;
    for (let k = 0; k < W * H; k++) {
      const i = k * 4;
      if (ref.depth[k] === Infinity) { if (!isBackground(got, i)) stray++; continue; }
      refPixels++;
      if (Math.abs(got[i] - ref.color[k * 3]) <= 40 && Math.abs(got[i + 1] - ref.color[k * 3 + 1]) <= 40 && Math.abs(got[i + 2] - ref.color[k * 3 + 2]) <= 40) matched++;
    }
    emit({ info: { centre_points: cloud.count, centre_ref_pixels: refPixels, centre_stray_pixels: stray } });
    emit({
      check: 'centre-tile-matches-cpu', pass: refPixels > 0.2 * W * H && matched >= 0.9 * refPixels && stray <= 0.02 * refPixels,
      detail: `${matched} of ${refPixels} covered pixels within 40/255 of the CPU splat (${(100 * matched / Math.max(1, refPixels)).toFixed(1)}%), ${stray} drawn where it has none`,
    });
  } else emit({ check: 'centre-tile-matches-cpu', pass: false, detail: `centre tile ${centre.z}/${centre.x}/${centre.y} did not load` });

  // Leave the opening view on screen for the screenshot.
  Object.assign(io.camera, home);
  io.draw(meshes);
  await io.finish();
  emit({ done: true });
}

export interface App {
  gl: WebGL2RenderingContext;
  draw(camera: Camera, meshes: Mesh[]): void;
  camera: Camera;
  origin: Origin;
  ready(): boolean;
  freeze(): void;
  idle(): boolean;
  visible(): VisibleTile<Mesh>[];
  error(): string;
}

export async function run(app: App): Promise<void> {
  const { gl, camera } = app;
  const px = new Uint8Array(4);
  await measure<Mesh>({
    camera, origin: app.origin, ready: app.ready, freeze: app.freeze, idle: app.idle, visible: app.visible, error: app.error,
    info: { gpu: glRenderer(gl), api: 'webgl2' },
    size: () => [gl.drawingBufferWidth, gl.drawingBufferHeight],
    draw: (meshes) => app.draw(camera, meshes),
    finish: async () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); },
    frames: (steps, set, meshes, prefix) => benchFrames(gl, steps, (i) => { set(i); app.draw(camera, meshes); }, { prefix }),
    screen: async (meshes) => {
      app.draw(camera, meshes);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const raw = new Uint8Array(W * H * 4), out = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      for (let y = 0; y < H; y++) out.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      return out;
    },
  });
}
