// cesium-202-japan-buildings: PLATEAU buildings of central Tokyo on a globe,
// streamed by screen-space error, with flights between preset places.
import { frameAt, eyeLocal, cameraBasis, altitude, type Cam, type V3 } from './geo.ts';
import { flight, type Flight } from './flight.ts';
import { perspective, viewOf, mul, nearFar } from './camera.ts';
import { frustumPlanes, type IndexJson, type View } from './lod.ts';
import { TileStream } from './stream.ts';
import { Renderer, type FrameState } from './render.ts';
import { rampCss } from './ramp.ts';

const started = performance.now();
const BASE = '../../../data/baked/cesium-202-japan-buildings/';
const FOV_Y = 45;
const q = new URLSearchParams(location.search);
const BUDGET_MB = +(q.get('budget') ?? 192);
const MAX_SSE = +(q.get('sse') ?? 3);

// A view by what it looks at: target (lat, lon), heading, pitch (down is
// negative) and distance. The camera stands back along the heading.
function lookingAt(lat: number, lon: number, heading: number, pitch: number, range: number): Cam {
  const back = range * Math.cos(pitch * Math.PI / 180), up = -range * Math.sin(pitch * Math.PI / 180);
  const hd = heading * Math.PI / 180;
  return {
    lat: lat - back * Math.cos(hd) / 110950,
    lon: lon - back * Math.sin(hd) / (111320 * Math.cos(lat * Math.PI / 180)),
    h: up, heading, pitch,
  };
}

export const PRESETS: Record<string, { name: string; cam: Cam }> = {
  kanto: { name: '関東平野', cam: lookingAt(35.9, 139.7, 0, -25, 250000) },
  tokyo: { name: '東京都心', cam: lookingAt(35.675, 139.745, 315, -28, 9000) },
  shinjuku: { name: '新宿副都心', cam: lookingAt(35.6893, 139.6935, 262, -14, 1700) },
  marunouchi: { name: '東京駅・丸の内', cam: lookingAt(35.6812, 139.7671, 300, -25, 1500) },
  roppongi: { name: '六本木・虎ノ門', cam: lookingAt(35.664, 139.738, 330, -22, 2200) },
  shibuya: { name: '渋谷', cam: lookingAt(35.6595, 139.7005, 240, -20, 1400) },
  odaiba: { name: 'お台場・湾岸', cam: lookingAt(35.632, 139.775, 340, -24, 3500) },
};

const canvas = document.getElementById('map') as HTMLCanvasElement;
const statusEl = document.getElementById('status')!;
const gl = canvas.getContext('webgl2', { antialias: true, depth: true, powerPreference: 'high-performance' });
if (!gl) throw new Error('WebGL2 is not available');
const renderer = new Renderer(gl);

const inflate = async (res: Response): Promise<Uint8Array> =>
  new Uint8Array(await new Response(res.body!.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

const index = await (await fetch(BASE + 'index.json')).json() as IndexJson & { masks: { name: string; grid: { w: number; h: number; lon0: number; lat0: number; dlon: number; dlat: number } }[] };
const frame = frameAt(...index.origin), R = index.R;
const stream = new TileStream(gl, index, BASE, BUDGET_MB * 1024 * 1024);
await Promise.all(index.masks.map(async ({ name, grid: g }) => {
  renderer.setMask(name, g.w, g.h, await inflate(await fetch(`${BASE}land-${name}.bin`)), [g.lon0, g.lat0, g.w * g.dlon, g.h * g.dlat]);
}));
(document.getElementById('legend') as HTMLElement).style.background = rampCss(250);

let cam: Cam = { ...PRESETS.kanto.cam };
let fly: { f: Flight; t0: number; done: () => void } | null = null;
let raf = 0;
let firstFrameMs = 0, globeFrameMs = 0;
const frameWork: number[] = [];
let recordWork = false;

function frameState(c: Cam): FrameState {
  const w = canvas.width, h = canvas.height;
  const eye = eyeLocal(frame, c), basis = cameraBasis(frame, c), alt = altitude(eye, R);
  const [near, far] = nearFar(alt, R);
  const tanY = Math.tan(FOV_Y * Math.PI / 360), tanX = tanY * w / h;
  const vp = mul(perspective(FOV_Y, w / h, near, far), viewOf(basis));
  return { frame, R, eye, basis, vp, tanX, tanY, near, far, alt };
}

function viewOfState(s: FrameState): View {
  return { eye: s.eye, planes: frustumPlanes(s.vp), height: canvas.height / (devicePixelRatio || 1), tanHalfFov: s.tanY, maxSSE: MAX_SSE, R };
}

function draw(now: number): void {
  const t = performance.now();
  if (fly) {
    const u = (now - fly.t0) / fly.f.ms;
    cam = fly.f.at(Math.min(1, u));
    if (u >= 1) { const d = fly.done; fly = null; d(); }
  }
  const s = frameState(cam);
  const tiles = stream.update(viewOfState(s));
  renderer.draw(s, tiles);
  if (recordWork) frameWork.push(performance.now() - t);
  if (!globeFrameMs) globeFrameMs = performance.now() - started;
  if (!firstFrameMs && tiles.some((x) => x.node.key === '0/0/0')) firstFrameMs = performance.now() - started;
  statusEl.textContent = `建物 ${renderer.drawnBuildings.toLocaleString('en')} 棟 (${renderer.drawnTiles} タイル) · 読込中 ${stream.pending + stream.wanted} · GPU ${(stream.lru.bytes / 1048576).toFixed(0)} MB · 高度 ${s.alt >= 10000 ? (s.alt / 1000).toFixed(0) + ' km' : s.alt.toFixed(0) + ' m'}`;
  if (fly || stream.pending > 0 || stream.wanted > 0) request();
}

function request(): void {
  if (!raf) raf = requestAnimationFrame((now) => { raf = 0; draw(now); });
}
stream.onArrive = request;

function flyTo(target: Cam): Promise<void> {
  return new Promise((resolve) => {
    fly = { f: flight(cam, target), t0: performance.now(), done: resolve };
    request();
  });
}

function setCam(c: Cam): void { cam = { ...c }; fly = null; request(); }

// Canvas size follows the element, in device pixels.
new ResizeObserver(() => {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  request();
}).observe(canvas);

// Controls: drag pans along the ground, right-drag (or Shift) turns and
// tilts, the wheel changes height.
let drag: { id: number; x: number; y: number; turn: boolean } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, turn: e.button === 2 || e.shiftKey };
  fly = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.turn) {
    cam.heading = (cam.heading + dx * 0.25 + 360) % 360;
    cam.pitch = Math.max(-89, Math.min(-2, cam.pitch - dy * 0.2));
  } else {
    const m = Math.max(1, cam.h) * 2 * Math.tan(FOV_Y * Math.PI / 360) / canvas.clientHeight;
    const hd = cam.heading * Math.PI / 180;
    const right = -dx * m, fwd = dy * m / Math.max(0.3, Math.sin(-cam.pitch * Math.PI / 180));
    const east = right * Math.cos(hd) + fwd * Math.sin(hd), north = -right * Math.sin(hd) + fwd * Math.cos(hd);
    cam.lat += north / 110950;
    cam.lon += east / (111320 * Math.cos(cam.lat * Math.PI / 180));
  }
  request();
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  fly = null;
  cam.h = Math.max(60, Math.min(2e7, cam.h * Math.exp(e.deltaY * 0.0015)));
  request();
}, { passive: false });

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-place]')) {
  b.addEventListener('click', () => { const p = PRESETS[b.dataset.place!]; if (p) flyTo(p.cam); });
}

request();
// The opening: from the Kanto plain down to the skyline, once the tallest
// buildings (the root tile) are on the GPU or after 1.5 s, whichever first.
const opening = (async () => {
  const t = performance.now();
  while (!stream.gpu.has('0/0/0') && performance.now() - t < 1500) await new Promise(requestAnimationFrame);
  recordWork = true;
  const t1 = performance.now();
  await flyTo(PRESETS.tokyo.cam);
  recordWork = false;
  return { startedMs: t1 - started };
})();

export interface App {
  gl: WebGL2RenderingContext; canvas: HTMLCanvasElement; renderer: Renderer; stream: TileStream; index: typeof index;
  presets: typeof PRESETS; opening: Promise<{ startedMs: number }>; frameWork: number[];
  cam: () => Cam; setCam: (c: Cam) => void; flyTo: (c: Cam) => Promise<void>;
  state: () => FrameState; drawNow: () => void; firstFrameMs: () => number; globeFrameMs: () => number;
  eyeRel: (p: V3) => V3;
}
const app: App = {
  gl, canvas, renderer, stream, index, presets: PRESETS, opening, frameWork,
  cam: () => cam, setCam, flyTo, state: () => frameState(cam),
  drawNow: () => draw(performance.now()),
  firstFrameMs: () => firstFrameMs, globeFrameMs: () => globeFrameMs,
  eyeRel: (p) => { const e = eyeLocal(frame, cam); return [p[0] - e[0], p[1] - e[1], p[2] - e[2]]; },
};
(window as unknown as { __app: App }).__app = app;

if (q.has('bench')) await (await import('./bench.ts')).run(app);
