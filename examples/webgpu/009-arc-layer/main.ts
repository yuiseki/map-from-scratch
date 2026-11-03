import { decodeArcData, type ArcDataset, type FlowRecord } from './arc.ts';
import { createRenderer, type Camera } from './render.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const detail = document.getElementById('detail')!;

const countySelect = document.getElementById('county-select') as HTMLSelectElement;
const heightInput = document.getElementById('height-scale') as HTMLInputElement;
const heightVal = document.getElementById('height-val')!;
const widthInput = document.getElementById('line-width') as HTMLInputElement;
const widthVal = document.getElementById('width-val')!;

let renderer: Awaited<ReturnType<typeof createRenderer>>;
try {
  renderer = await createRenderer(canvas);
} catch (error) {
  status.textContent = String(error);
  status.style.color = '#ff8080';
  throw error;
}

// Centered over US mainland (Mercator x: ~0.23, y: ~0.37)
// In [-1, 1] WebGPU coordinates: x = 0.23 * 2 - 1 = -0.54, y = (1 - 0.37) * 2 - 1 = 0.26
const camera: Camera = {
  x: -0.54,
  y: 0.24,
  distance: 1.15,
  pitch: 45,
  yaw: 0,
  width: 1,
  height: 1,
  heightScale: 1.2,
  lineWidth: 2.2,
};

let dataset: ArcDataset | null = null;
let currentFlows: FlowRecord[] = [];
let scheduled = false;
let frozen = false;

function schedule() {
  if (scheduled || frozen) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    draw();
  });
}

function draw() {
  camera.width = canvas.clientWidth;
  camera.height = canvas.clientHeight;
  renderer.draw(camera);
}

function filterCountyFlows(countyIdx: number) {
  if (!dataset) return;
  if (countyIdx === -1) {
    // Show top 3,000 national flows by magnitude
    currentFlows = dataset.flows.slice(0, 3000);
    detail.innerHTML = `<strong>全米 上位フロー</strong><small>国内の主要移動 3,000 アークを表示中</small>`;
  } else {
    // Flows where s or t is selected county
    currentFlows = dataset.flows.filter(f => f.s === countyIdx || f.t === countyIdx);
    const name = dataset.names[countyIdx] || `郡 #${countyIdx}`;
    detail.innerHTML = `<strong>${name}</strong><small>流出入フロー: ${currentFlows.length} アーク</small>`;
  }
  renderer.uploadArcs(currentFlows, dataset.centroids);
  schedule();
}

countySelect.addEventListener('change', () => {
  filterCountyFlows(Number(countySelect.value));
});

heightInput.addEventListener('input', () => {
  camera.heightScale = Number(heightInput.value);
  heightVal.textContent = `${camera.heightScale.toFixed(1)}×`;
  schedule();
});

widthInput.addEventListener('input', () => {
  camera.lineWidth = Number(widthInput.value);
  widthVal.textContent = `${camera.lineWidth.toFixed(1)}px`;
  schedule();
});

const PLACES: Record<string, { x: number; y: number; distance: number; pitch: number; yaw: number }> = {
  us:        { x: -0.54, y: 0.24, distance: 1.15, pitch: 45, yaw: 0 },
  california:{ x: -0.67, y: 0.21, distance: 0.38, pitch: 52, yaw: 25 },
  texas:     { x: -0.55, y: 0.12, distance: 0.42, pitch: 48, yaw: 10 },
  ny:        { x: -0.41, y: 0.31, distance: 0.32, pitch: 55, yaw: -20 },
};

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-place]')) {
  b.addEventListener('click', () => {
    const p = PLACES[b.dataset.place ?? ''];
    if (p) {
      Object.assign(camera, p);
      schedule();
    }
  });
}

let drag: { x: number; y: number; right: boolean } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, right: e.button === 2 || e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.right) {
    const yaw = camera.yaw * Math.PI / 180;
    const factor = camera.distance * 0.0014;
    camera.x -= (Math.cos(yaw) * dx - Math.sin(yaw) * dy) * factor;
    camera.y += (Math.sin(yaw) * dx + Math.cos(yaw) * dy) * factor;
  } else {
    camera.yaw = (camera.yaw + dx * 0.35) % 360;
    camera.pitch = Math.max(10, Math.min(85, camera.pitch + dy * 0.3));
  }
  schedule();
});

canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.distance = Math.max(0.08, Math.min(3.5, camera.distance * Math.exp(e.deltaY * 0.0015)));
  schedule();
}, { passive: false });

new ResizeObserver(schedule).observe(canvas);

// Load data
try {
  const t0 = performance.now();
  const res = await fetch('../../../data/baked/deckgl-001-arc-layer/arcs.bin');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  dataset = decodeArcData(buf);
  renderer.uploadLand(dataset.landRings);

  // Populate county options
  const topCounties = [
    { name: '全米上位フロー (3,000本)', idx: -1 },
    ...dataset.names.slice(0, 50).map((name, idx) => ({ name, idx })),
  ];
  countySelect.innerHTML = topCounties
    .map(c => `<option value="${c.idx}">${c.name}</option>`)
    .join('');

  filterCountyFlows(-1);

  const elapsed = Math.round(performance.now() - t0);
  status.textContent = `${dataset.countyCount} 郡 · ${dataset.flowCount.toLocaleString()} 本の移動フロー準備完了 [${elapsed} ms]`;
} catch (error) {
  status.textContent = `データ読み込みエラー: ${String(error)}`;
  status.style.color = '#ff8080';
}

if (new URLSearchParams(location.search).has('bench')) {
  void import('./bench.ts').then(({ run }) => run({
    device: renderer.device,
    gpu: renderer.gpu,
    draw: renderer.draw,
    readScreen: renderer.readScreen,
    camera,
    dataset: () => dataset,
    ready: () => dataset !== null && currentFlows.length > 0,
    freeze: () => { frozen = true; },
  }));
}
