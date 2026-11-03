// cesium-254-polyline-volume: Japan's Shinkansen lines as swept tubes on a
// globe. Data: data/baked/cesium-254-polyline-volume (bake.ts).
import { decodeLines, decodeLand } from './format.ts';
import { landMesh, toEcef } from './land.ts';
import { tubeMesh } from './tubes.ts';
import { Renderer } from './render.ts';
import { JAPAN, FUJI, drag, zoomAt, flyBetween, clampCam, project, onNearSide, type Cam } from './camera.ts';
import { pulseHead } from './pulse.ts';
import { LINES, hexToRgb } from './lines.ts';
import type { Shape, Corner, Mesh } from './sweep.ts';

export interface Meta {
  lines: { name: string; en: string; speed_kmh: number; km: number; points: number }[];
  stations: { name: string; en: string; line: number; lon: number; lat: number; m_from_line: number }[];
}

const BASE = '../../../data/baked/cesium-254-polyline-volume/';
const canvas = document.getElementById('map') as HTMLCanvasElement;
const [lb, ld, meta] = await Promise.all([
  fetch(BASE + 'lines.bin').then((r) => r.arrayBuffer()),
  fetch(BASE + 'land.bin').then((r) => r.arrayBuffer()),
  fetch(BASE + 'meta.json').then((r) => r.json() as Promise<Meta>),
]);
const lines = decodeLines(lb);
const origin = toEcef(137.5, 36.5, 0);
const renderer = new Renderer(canvas, origin);
const land = landMesh(decodeLand(ld), origin);
renderer.setLand(land.pos, land.idx);

const state = { cam: { ...JAPAN } as Cam, shape: 'circle' as Shape, corner: 'round' as Corner, pulse: true };
const colours = LINES.map((l) => hexToRgb(l.colour));
let mesh: Mesh;
let lengths: number[] = [];
function rebuild(): void {
  mesh = tubeMesh(lines, state.shape, state.corner, origin);
  renderer.setTubes(mesh);
  lengths = LINES.map((_, i) => Math.max(0, ...mesh.ringAlong.filter((_, r) => mesh.ringLine[r] === i)));
  (document.getElementById('tris') as HTMLElement).textContent = `${renderer.triangles.toLocaleString('en')} triangles`;
}
rebuild();
const heads = (t: number) => meta.lines.map((l, i) => pulseHead(t, l.speed_kmh, lengths[i]));

// ---- labels ----
const labelLayer = document.getElementById('labels') as HTMLElement;
const labels = [
  ...meta.stations.map((s) => ({ lon: s.lon, lat: s.lat, text: `${s.name} ${s.en}`, cls: 'st' })),
  { lon: 138.7274, lat: 35.3606, text: '富士山 Mt Fuji 3,776 m', cls: 'peak' },
].map((l) => {
  const el = document.createElement('div');
  el.className = `label ${l.cls}`;
  el.textContent = l.text;
  labelLayer.appendChild(el);
  return { ...l, el, p: toEcef(l.lon, l.lat, 0) };
});
function placeLabels(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of labels) {
    const s = onNearSide(state.cam, l.p) ? project(state.cam, w, h, l.p) : null;
    const show = !!s && s[0] > 0 && s[1] > 0 && s[0] < w && s[1] < h && (l.cls === 'peak' || l.text.startsWith('新富士') ? state.cam.range < 600 : true);
    l.el.style.display = show ? '' : 'none';
    if (show) l.el.style.transform = `translate(${s![0].toFixed(1)}px, ${s![1].toFixed(1)}px)`;
  }
}

// ---- drawing ----
const start = performance.now();
let firstFrameMs = 0;
function draw(tSec: number): void {
  renderer.draw(state.cam, colours, heads(tSec), state.pulse);
  placeLabels();
}
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  request();
}
let fly: { from: Cam; to: Cam; t0: number; ms: number } | null = null;
let pending = false;
const bench = new URLSearchParams(location.search).has('bench');
function frame(now: number): void {
  pending = false;
  if (fly) {
    const t = Math.min(1, (now - fly.t0) / fly.ms);
    state.cam = flyBetween(fly.from, fly.to, t);
    if (t >= 1) fly = null;
  }
  draw((now - start) / 1000);
  if (!firstFrameMs) {
    renderer.gl.readPixels(0, 0, 1, 1, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, new Uint8Array(4));
    firstFrameMs = performance.now();
  }
  if ((state.pulse && !bench) || fly) request();
}
function request(): void {
  if (!pending) { pending = true; requestAnimationFrame(frame); }
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---- input ----
let last: { x: number; y: number; rot: boolean } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  fly = null;
  last = { x: e.clientX, y: e.clientY, rot: e.button === 2 || e.ctrlKey || e.shiftKey };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!last) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  if (last.rot) state.cam = clampCam({ ...state.cam, heading: state.cam.heading + dx * 0.005, tilt: state.cam.tilt + dy * 0.005 });
  else state.cam = drag(state.cam, dx, dy, canvas.clientWidth, canvas.clientHeight);
  last.x = e.clientX; last.y = e.clientY;
  request();
});
const up = () => { last = null; };
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  fly = null;
  const r = canvas.getBoundingClientRect();
  const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  state.cam = zoomAt(state.cam, Math.exp(d * 0.0015), e.clientX - r.left, e.clientY - r.top, canvas.clientWidth, canvas.clientHeight);
  request();
}, { passive: false });

const flyTo = (to: Cam, ms = 3500) => { fly = { from: { ...state.cam }, to, t0: performance.now(), ms }; request(); };
document.getElementById('fuji')!.addEventListener('click', () => flyTo(FUJI));
document.getElementById('japan')!.addEventListener('click', () => flyTo(JAPAN));
const shapeSel = document.getElementById('shape') as HTMLSelectElement;
const cornerSel = document.getElementById('corner') as HTMLSelectElement;
const pulseBox = document.getElementById('pulse') as HTMLInputElement;
shapeSel.addEventListener('change', () => { state.shape = shapeSel.value as Shape; rebuild(); request(); });
cornerSel.addEventListener('change', () => { state.corner = cornerSel.value as Corner; rebuild(); request(); });
pulseBox.addEventListener('change', () => { state.pulse = pulseBox.checked; request(); });

// ---- legend ----
const legend = document.getElementById('legend') as HTMLElement;
meta.lines.forEach((l, i) => {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<i style="background:${LINES[i].colour};box-shadow:0 0 6px ${LINES[i].colour}"></i><span>${l.name}</span><span class="en">${l.en}</span><span class="kmh">${l.speed_kmh} km/h</span>`;
  legend.appendChild(row);
});

export interface App {
  renderer: Renderer; state: typeof state; meta: Meta; lines: Float64Array[]; origin: number[];
  draw: (t: number) => void; rebuild: () => void; mesh: () => Mesh; heads: (t: number) => number[];
  firstFrame: () => number;
}
const app: App = { renderer, state, meta, lines, origin, draw, rebuild, mesh: () => mesh, heads, firstFrame: () => firstFrameMs };
(window as unknown as { __mfs254: App }).__mfs254 = app;
if (bench) {
  while (!firstFrameMs) await new Promise(requestAnimationFrame);
  void import('./bench.ts').then((b) => b.run(app));
}
