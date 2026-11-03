import { Renderer, type Heights } from './render.ts';
import { decodePoints, yearRange } from './points.ts';
import { heightsFromRGBA } from './tiles.ts';
import { orbit, pan, zoomAt, bindDrag } from './controls.ts';
import type { View } from './camera.ts';

const DATA = '../../../data/baked/maplibre-052-create-a-heatmap-layer-on-a-globe-with-terrain-elevation/';
const canvas = document.getElementById('map') as HTMLCanvasElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Decode a two-byte height WebP without colour management (lossless, so exact).
async function heights(url: string): Promise<{ h: Float32Array; w: number; hgt: number }> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { h: heightsFromRGBA(data, bmp.width, bmp.height), w: bmp.width, hgt: bmp.height };
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
resize();

// Opening view: over the Akita plain looking east-north-east at the Ou
// mountains, pitched like the original (71 degrees).
const view: View = { lon: 140.33, lat: 39.62, zoom: 8.7, pitch: 70, bearing: 72, centerH: 0, width: canvas.width, height: canvas.height };

const [meta, pts, area] = await Promise.all([
  fetch(DATA + 'meta.json').then((r) => r.json()),
  fetch(DATA + 'points.bin').then((r) => r.arrayBuffer()),
  heights(DATA + 'akita-z9.webp'),
]);
const points = decodePoints(pts);
let r: Renderer;
try {
  r = new Renderer(canvas, { ...area, grid: meta.area } as Heights, points, view);
} catch (e) {
  $('err').textContent = String(e);
  throw e;
}

let pending = false;
const redraw = () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; r.draw(); });
};
r.draw();
r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now();         // since navigation start, terrain and heat on screen

const worldReady = heights(DATA + 'world-z1.webp').then((w) => { r.setWorld({ ...w, grid: meta.world }); redraw(); });

new ResizeObserver(() => { resize(); redraw(); }).observe(canvas);

// Controls.
const yearSel = $<HTMLSelectElement>('year');
for (let i = 0; i < points.yearCounts.length; i++) yearSel.add(new Option(`${points.firstYear + i}`, `${points.firstYear + i}`));
const showCount = () => { const [a, b] = yearRange(points, r.year); $('count').textContent = `${b - a}件`; };
showCount();
yearSel.addEventListener('change', () => { r.year = Number(yearSel.value); showCount(); redraw(); });
const slider = (id: string, set: (n: number) => void) => {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('input', () => { set(Number(el.value)); $(id + 'Out').textContent = el.value; redraw(); });
};
slider('radius', (n) => { r.radius = n; });
slider('intensity', (n) => { r.intensity = n; });

bindDrag(canvas, (cx, cy, shift) => {
  const dpr = canvas.width / canvas.clientWidth;
  if (shift) pan(view, cx * dpr, cy * dpr); else orbit(view, cx, cy);
  redraw();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dpr = canvas.width / canvas.clientWidth, rect = canvas.getBoundingClientRect();
  const dz = -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002);
  zoomAt(view, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr, Math.max(-1, Math.min(1, dz)));
  redraw();
}, { passive: false });

if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(r, firstFrameMs, worldReady);
