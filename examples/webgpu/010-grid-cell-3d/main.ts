import { decodeGridCells, type GridDataset } from './grid.ts';
import { createRenderer, type Camera } from './render.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const detail = document.getElementById('detail')!;

const elevInput = document.getElementById('elevation') as HTMLInputElement;
const elevVal = document.getElementById('elevation-val')!;
const covInput = document.getElementById('coverage') as HTMLInputElement;
const covVal = document.getElementById('coverage-val')!;

let renderer: Awaited<ReturnType<typeof createRenderer>>;
try {
  renderer = await createRenderer(canvas);
} catch (error) {
  status.textContent = String(error);
  status.style.color = '#ff8080';
  throw error;
}

const camera: Camera = {
  x: 0,
  y: 0,
  distance: 18000, // 18 km viewing distance
  pitch: 50,
  yaw: 30,
  width: 1,
  height: 1,
  elevationScale: 1.0,
  coverage: 0.88,
};

let currentDataset: GridDataset | null = null;
let currentResolution = 256;
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

async function loadResolution(size: number) {
  status.textContent = `グリッド ${size}m を読み込み中…`;
  try {
    const t0 = performance.now();
    const res = await fetch(`../../../data/baked/deckgl-010-grid-layer/grid-${size}.bin`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    currentDataset = decodeGridCells(buf);
    currentResolution = size;
    renderer.uploadCells(currentDataset.cells, size);
    const elapsed = Math.round(performance.now() - t0);
    status.textContent = `${currentDataset.count.toLocaleString()} セル (${size}m メッシュ) 読み込み完了 [${elapsed} ms]`;

    let totalTrees = 0;
    for (const c of currentDataset.cells) totalTrees += c.count;
    detail.innerHTML = `<strong>パリ市内 ${totalTrees.toLocaleString()} 本の街路樹</strong><small>${size}m グリッド別密度立体柱</small>`;
    schedule();
  } catch (err) {
    status.textContent = `読み込みエラー: ${String(err)}`;
    status.style.color = '#ff8080';
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-res]')) {
  b.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('[data-res]').forEach(el => el.classList.remove('active'));
    b.classList.add('active');
    void loadResolution(Number(b.dataset.res));
  });
}

elevInput.addEventListener('input', () => {
  camera.elevationScale = Number(elevInput.value);
  elevVal.textContent = `${camera.elevationScale.toFixed(1)}×`;
  schedule();
});

covInput.addEventListener('input', () => {
  camera.coverage = Number(covInput.value);
  covVal.textContent = `${Math.round(camera.coverage * 100)}%`;
  schedule();
});

const PLACES: Record<string, { x: number; y: number; distance: number; pitch: number; yaw: number }> = {
  overview: { x: 0, y: 0, distance: 18000, pitch: 50, yaw: 30 },
  center:   { x: 300, y: -200, distance: 6500, pitch: 58, yaw: 45 },
  bois:     { x: -5500, y: 500, distance: 8000, pitch: 54, yaw: 15 },
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
  camera.distance = Math.max(1200, Math.min(50000, camera.distance * Math.exp(e.deltaY * 0.0015)));
  schedule();
}, { passive: false });

new ResizeObserver(schedule).observe(canvas);

// Initial load at 256m
void loadResolution(256);

if (new URLSearchParams(location.search).has('bench')) {
  void import('./bench.ts').then(({ run }) => run({
    device: renderer.device,
    gpu: renderer.gpu,
    draw: renderer.draw,
    readScreen: renderer.readScreen,
    camera,
    dataset: () => currentDataset,
    ready: () => currentDataset !== null && currentDataset.cells.length > 0,
    freeze: () => { frozen = true; },
  }));
}
