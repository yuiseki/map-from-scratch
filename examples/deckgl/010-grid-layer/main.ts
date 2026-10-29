import { TreeMap, gridSizes } from './renderer.ts';

const started = performance.now();
const base = '../../../data/baked/deckgl-010-grid-layer/';
async function get(path: string): Promise<ArrayBuffer> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}
const [trees, grids, species] = await Promise.all([
  get('trees.bin'),
  Promise.all(gridSizes.map((size) => get(`grid-${size}.bin`))),
  fetch(base + 'species.json').then(async (response) => {
    if (!response.ok) throw new Error(`species: HTTP ${response.status}`);
    return response.json() as Promise<string[]>;
  }),
]);
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new TreeMap(canvas, trees, grids, species);
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
const status = document.getElementById('status')!;
const refresh = () => { status.textContent = `${map.treeCount.toLocaleString('ja-JP')} 本 · ${map.activeLabel} · zoom ${map.zoom.toFixed(1)}`; };
refresh();
const cell = document.getElementById('cell-pixels') as HTMLInputElement;
cell.addEventListener('input', () => {
  map.cellPixels = Number(cell.value);
  document.getElementById('cell-pixels-value')!.textContent = `${map.cellPixels} px`;
  map.draw(); refresh();
});
const fade = document.getElementById('fade') as HTMLInputElement;
fade.addEventListener('input', () => {
  map.fadeWidth = Number(fade.value);
  document.getElementById('fade-value')!.textContent = `${map.fadeWidth.toFixed(1)} zoom`;
  map.draw(); refresh();
});
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (event) => { drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
const tooltip = document.getElementById('tooltip')!;
canvas.addEventListener('pointermove', (event) => {
  if (drag) {
    map.pan(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
    tooltip.style.display = 'none'; refresh(); return;
  }
  const message = map.hover(event.clientX, event.clientY);
  tooltip.style.display = message ? 'block' : 'none';
  if (message) { tooltip.textContent = message; tooltip.style.left = `${event.clientX + 12}px`; tooltip.style.top = `${event.clientY + 12}px`; }
});
canvas.addEventListener('pointerleave', () => { tooltip.style.display = 'none'; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  map.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  refresh();
}, { passive: false });
window.addEventListener('resize', () => map.resize());
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(map, firstFrameMs);
