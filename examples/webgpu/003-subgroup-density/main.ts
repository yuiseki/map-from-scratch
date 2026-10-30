// examples/webgpu/003-subgroup-density/main.ts
import { mount } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const hudSubgroups = document.getElementById('hud-subgroups');
const hudPeak = document.getElementById('hud-peak');

const DATA_URL = '../../../data/baked/webgpu-003-subgroup-density/points.bin';

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}

resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
});

const startTime = performance.now();
const map = await mount(canvas, DATA_URL);
const firstFrameMs = performance.now() - startTime;

const isBench = new URLSearchParams(window.location.search).has('bench');

if (hudSubgroups) {
  hudSubgroups.textContent = map.hasSubgroups ? 'Enabled (one atomic per run of lanes in a cell)' : 'Not available (one atomic per point)';
}
const hudGrid = document.getElementById('hud-grid');
if (hudGrid) {
  const [, , , , gw, gh] = map.view();
  hudGrid.textContent = `${gw} × ${gh} (${(gw * gh).toLocaleString()} cells)`;
}

if (!isBench) {
  map.getMaxDensity().then(val => {
    if (hudPeak) hudPeak.textContent = val.toLocaleString();
  });
}

// Interactive Pan & Zoom
let isDragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  map.panBy(dx, dy);
  map.getMaxDensity().then(val => {
    if (hudPeak) hudPeak.textContent = val.toLocaleString();
  });
});

canvas.addEventListener('pointerup', () => {
  isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = -e.deltaY * 0.002;
  const r = canvas.getBoundingClientRect();
  map.zoomBy(delta, e.clientX - r.left, e.clientY - r.top);
  map.getMaxDensity().then(val => {
    if (hudPeak) hudPeak.textContent = val.toLocaleString();
  });
}, { passive: false });

// Benchmark hook
if (new URLSearchParams(window.location.search).has('bench')) {
  const { runBench } = await import('./bench.ts');
  await runBench(map, firstFrameMs);
}
