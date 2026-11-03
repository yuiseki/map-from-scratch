import { createRenderer, type Camera, type PointDataset } from './render.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const detail = document.getElementById('detail')!;

const radiusInput = document.getElementById('radius') as HTMLInputElement;
const radiusVal = document.getElementById('radius-val')!;
const elevInput = document.getElementById('elevation') as HTMLInputElement;
const elevVal = document.getElementById('elevation-val')!;
const covInput = document.getElementById('coverage') as HTMLInputElement;
const covVal = document.getElementById('coverage-val')!;
const percInput = document.getElementById('percentile') as HTMLInputElement;
const percVal = document.getElementById('percentile-val')!;

let renderer: Awaited<ReturnType<typeof createRenderer>>;
try {
  renderer = await createRenderer(canvas);
} catch (error) {
  status.textContent = String(error);
  status.style.color = '#ff8080';
  throw error;
}

const camera: Camera = {
  x: -220000,
  y: 7000000,
  distance: 920000,
  pitch: 46,
  yaw: 15,
  width: 1,
  height: 1,
  radius: 1000,
  elevationScale: 1.0,
  coverage: 0.88,
  upperPercentile: 90,
};

let dataset: PointDataset | null = null;
let scheduled = false;
let frozen = false;
let lastRebinTimeMs = 0;
const fmt = new Intl.NumberFormat('ja-JP');

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

async function triggerRebin() {
  if (!dataset) return;
  const t0 = performance.now();
  renderer.runBinning(camera.radius, dataset.bounds);
  const stats = await renderer.computeCellStats(camera.upperPercentile);
  lastRebinTimeMs = performance.now() - t0;

  detail.innerHTML = `<strong>${fmt.format(stats.active)} 六角セル</strong> (総事故: ${fmt.format(stats.totalCount)} 件)<br>` +
    `1セル最大: ${stats.max} 件 | GPU 再集計: <strong>${lastRebinTimeMs.toFixed(2)} ms</strong>`;
  schedule();
}

// Convert 16-bit normalized accident points to Web Mercator meters
function parsePointsBin(buffer: ArrayBuffer): PointDataset {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'HX01') throw new Error('データ形式が一致しません');

  const count = view.getUint32(4, true);
  const west = view.getFloat32(8, true);
  const north = view.getFloat32(12, true);
  const east = view.getFloat32(16, true);
  const south = view.getFloat32(20, true);

  const EARTH_CIRCUMFERENCE = 40075016.68557849;
  const toMeterX = (u: number) => (u - 0.5) * EARTH_CIRCUMFERENCE;
  const toMeterY = (v: number) => (0.5 - v) * EARTH_CIRCUMFERENCE;

  const minX = toMeterX(west), maxX = toMeterX(east);
  // In normalized mercator, north has smaller y (from top 0)
  const maxY = toMeterY(north), minY = toMeterY(south);

  const points = new Float32Array(count * 2);
  let at = 32;
  for (let i = 0; i < count; i++) {
    const qx = view.getUint16(at, true) / 65535;
    const qy = view.getUint16(at + 2, true) / 65535;
    at += 4;
    const u = west + qx * (east - west);
    const v = north + qy * (south - north);
    points[i * 2] = toMeterX(u);
    points[i * 2 + 1] = toMeterY(v);
  }

  return { points, count, bounds: { minX, minY, maxX, maxY } };
}

// UI events
radiusInput.addEventListener('input', () => {
  camera.radius = Number(radiusInput.value);
  radiusVal.textContent = `${fmt.format(camera.radius)}m`;
  void triggerRebin();
});

elevInput.addEventListener('input', () => {
  camera.elevationScale = Number(elevInput.value);
  elevVal.textContent = `${camera.elevationScale.toFixed(1)}×`;
  schedule();
});

covInput.addEventListener('input', () => {
  camera.coverage = Number(covInput.value);
  covVal.textContent = camera.coverage.toFixed(2);
  schedule();
});

percInput.addEventListener('input', () => {
  camera.upperPercentile = Number(percInput.value);
  percVal.textContent = `${camera.upperPercentile}%`;
  void triggerRebin();
});

const PLACES: Record<string, { x: number; y: number; distance: number; pitch: number; yaw: number }> = {
  uk:          { x: -220000, y: 7000000, distance: 920000, pitch: 46, yaw: 15 },
  london:      { x: -15000, y: 6710000, distance: 75000, pitch: 55, yaw: 25 },
  manchester:  { x: -250000, y: 7070000, distance: 70000, pitch: 52, yaw: 10 },
  birmingham:  { x: -210000, y: 6885000, distance: 65000, pitch: 50, yaw: 20 },
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
  camera.distance = Math.max(10000, Math.min(2500000, camera.distance * Math.exp(e.deltaY * 0.0015)));
  schedule();
}, { passive: false });

new ResizeObserver(schedule).observe(canvas);

// Load data and run initial binning
try {
  const t0 = performance.now();
  const res = await fetch('../../../data/baked/deckgl-012-hexagon-layer/points.bin');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  dataset = parsePointsBin(buf);
  renderer.uploadPoints(dataset);
  const elapsed = Math.round(performance.now() - t0);
  status.textContent = `${fmt.format(dataset.count)} 点の事故データ取得完了 [${elapsed} ms] · WebGPU Compute 準備完了`;
  await triggerRebin();
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
    runBinning: renderer.runBinning,
    computeCellStats: renderer.computeCellStats,
    camera,
    dataset: () => dataset,
    ready: () => dataset !== null,
    freeze: () => { frozen = true; },
  }));
}
