import { decode } from './format.ts';
import { buildMesh } from './mesh.ts';
import { Renderer } from './render.ts';
import { ramp, scaleT, heightOf, legendTicks, STOPS } from './ramp.ts';
import { unproject, FOV_Y, MIN_DIST, MAX_DIST, type Camera } from './camera.ts';

const DATA = '../../../data/baked/maplibre-062-display-a-globe-with-a-fill-extrusion-layer';
type Row = [string, string, string, number]; // ADM0_A3, NAME, NAME_JA, POP_EST

export interface GlobeMap {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  cam: Camera;
  rows: Row[];
  popMax: number;
  tooltip: HTMLElement;
  toggle: HTMLButtonElement;
  firstFrameMs: number;
  draw(): void;
  setFlat(flat: boolean, animate: boolean): void;
  hoverAt(clientX: number, clientY: number): number;
}

const canvas = document.getElementById('map') as HTMLCanvasElement;
const tooltip = document.getElementById('tip')!;
const toggle = document.getElementById('proj') as HTMLButtonElement;

const [bin, rows] = await Promise.all([
  fetch(`${DATA}/countries.bin`).then((r) => r.arrayBuffer()),
  fetch(`${DATA}/countries.json`).then((r) => r.json() as Promise<Row[]>),
]);
const popMax = Math.max(...rows.map((r) => r[3]));
const mesh = buildMesh(decode(bin));
const renderer = new Renderer(canvas, mesh, rows.map((r) => ({ color: ramp(scaleT(r[3], popMax)), height: heightOf(r[3], popMax) })));

// Opening view: the original's centre (30 E, 40 N) shows Europe, Africa
// and western Asia, with China and India standing on the eastern limb;
// distance 4.5 puts the whole disc (327 px radius) inside a 768 px height.
// A hash #lon/lat/dist[/flat] opens another view.
const OPENING = { lon: 30, lat: 40, dist: 4.5 };
const hv = location.hash.slice(1).split('/').map(Number);
const cam: Camera = { lon: hv[0] || OPENING.lon, lat: hv[1] || OPENING.lat, dist: hv[2] || OPENING.dist, t: 0 };
let flat = false;

const dpr = () => window.devicePixelRatio || 1;
let pending = 0;
function draw(): void { renderer.draw(cam); }
function request(): void {
  if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(); });
}

new ResizeObserver(() => {
  const w = Math.round(canvas.clientWidth * dpr()), h = Math.round(canvas.clientHeight * dpr());
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; draw(); }
}).observe(canvas);
canvas.width = Math.round(canvas.clientWidth * dpr());
canvas.height = Math.round(canvas.clientHeight * dpr());
draw();
const firstFrameMs = performance.now();

// Legend from the same ramp and scale the renderer uses.
const legend = document.getElementById('legend')!;
const bar = legend.querySelector('.bar') as HTMLElement;
bar.style.background = `linear-gradient(to right, ${STOPS.map((c, i) => `rgb(${c.join(',')}) ${(i / (STOPS.length - 1)) * 100}%`).join(', ')})`;
const fmtPop = (p: number) => p >= 1e9 ? `${(p / 1e9).toFixed(2)}B` : p >= 1e6 ? `${Math.round(p / 1e6)}M` : `${Math.round(p)}`;
legend.querySelector('.ticks')!.innerHTML = legendTicks(popMax).map(({ t, pop }) => `<span style="left:${t * 100}%">${fmtPop(pop)}</span>`).join('');

const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function show(id: number, x: number, y: number): void {
  if (id < 0) { tooltip.hidden = true; return; }
  const r = rows[id];
  tooltip.textContent = `${r[1]}${r[2] !== r[1] ? ` (${r[2]})` : ''}  population ${group(r[3])}`;
  tooltip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  tooltip.hidden = false;
}

function devicePoint(clientX: number, clientY: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [(clientX - rect.left) * dpr(), (clientY - rect.top) * dpr()];
}
function hoverAt(clientX: number, clientY: number): number {
  const [x, y] = devicePoint(clientX, clientY);
  const id = renderer.pick(cam, x, y);
  if (id !== renderer.hover) { renderer.hover = id; request(); }
  show(id, clientX, clientY);
  return id;
}

const wrap = (d: number) => ((d + 540) % 360) - 180;
const clampLat = (l: number) => Math.max(flat ? -80 : -89, Math.min(flat ? 80 : 89, l));
// Move the view so the ground under device point a ends up under b.
function moveGround(a: [number, number], b: [number, number]): void {
  const w = canvas.width, h = canvas.height;
  const ga = unproject(cam, w, h, a[0], a[1]), gb = unproject(cam, w, h, b[0], b[1]);
  if (ga && gb) {
    cam.lon = wrap(cam.lon + wrap(ga[0] - gb[0]));
    cam.lat = clampLat(cam.lat + ga[1] - gb[1]);
  } else {
    // Off the globe: degrees per pixel at the centre.
    const pxPerRad = (h / 2) / Math.tan(FOV_Y / 2) / (cam.dist - 1);
    cam.lon = wrap(cam.lon - (b[0] - a[0]) / pxPerRad * 180 / Math.PI);
    cam.lat = clampLat(cam.lat + (b[1] - a[1]) / pxPerRad * 180 / Math.PI);
  }
}

let drag: { id: number; start: [number, number]; last: [number, number]; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  const p = devicePoint(e.clientX, e.clientY);
  drag = { id: e.pointerId, start: p, last: p, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) { hoverAt(e.clientX, e.clientY); return; }
  const p = devicePoint(e.clientX, e.clientY);
  if (!drag.moved && Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < 3 * dpr()) return;
  drag.moved = true;
  tooltip.hidden = true;
  moveGround(drag.last, p);
  drag.last = p;
  request();
});
const end = (e: PointerEvent) => {
  if (drag && !drag.moved) hoverAt(e.clientX, e.clientY); // a tap identifies
  drag = null;
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointerleave', () => { if (!drag) { tooltip.hidden = true; if (renderer.hover !== -1) { renderer.hover = -1; request(); } } });

// Wheel: zoom about the pointer (rendering-mistakes.md, "Wheel zoom about
// the screen centre").
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = devicePoint(e.clientX, e.clientY);
  const before = unproject(cam, canvas.width, canvas.height, p[0], p[1]);
  cam.dist = 1 + Math.max(MIN_DIST - 1, Math.min(MAX_DIST - 1, (cam.dist - 1) * Math.exp(e.deltaY * 0.0015)));
  const after = unproject(cam, canvas.width, canvas.height, p[0], p[1]);
  if (before && after) { cam.lon = wrap(cam.lon + wrap(before[0] - after[0])); cam.lat = clampLat(cam.lat + before[1] - after[1]); }
  request();
}, { passive: false });

// Globe / flat toggle, morphing over 700 ms like MapLibre's GlobeControl.
let anim = 0;
function setFlat(f: boolean, animate: boolean): void {
  flat = f;
  cam.lat = clampLat(cam.lat);
  toggle.textContent = f ? 'Globe' : 'Flat';
  toggle.title = f ? 'Show the globe' : 'Show the flat map (equirectangular)';
  cancelAnimationFrame(anim);
  const target = f ? 1 : 0;
  if (!animate) { cam.t = target; draw(); return; }
  const from = cam.t, t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / 700), s = k * k * (3 - 2 * k);
    cam.t = from + (target - from) * s;
    draw();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
toggle.addEventListener('click', () => setFlat(!flat, true));
setFlat(location.hash.endsWith('/flat'), false);

const map: GlobeMap = { canvas, renderer, cam, rows, popMax, tooltip, toggle, firstFrameMs, draw, setFlat, hoverAt };
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(map);
