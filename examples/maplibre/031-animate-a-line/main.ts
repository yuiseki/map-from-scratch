// examples/maplibre/031-animate-a-line/main.ts
import { mount } from './line.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const dataUrl = new URL('../../../data/baked/maplibre-031-animate-a-line/land.json', import.meta.url).href;

const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;

const stepCount = document.getElementById('step-count')!;
const btnToggle = document.getElementById('btn-toggle')!;
const btnReset = document.getElementById('btn-reset')!;

let active = true;
map.start();

// Update step display in UI
setInterval(() => {
  stepCount.textContent = `Point: ${map.getPointCount()} / 360`;
}, 100);

btnToggle.addEventListener('click', () => {
  active = !active;
  btnToggle.textContent = active ? 'Pause' : 'Play';
  if (active) map.start();
  else map.stop();
});

btnReset.addEventListener('click', () => {
  map.reset();
  stepCount.textContent = `Point: 0 / 360`;
});

// Benchmark runner attachment
if (window.location.search.includes('bench')) {
  map.stop();
  map.reset();
  import('./bench.ts').then((mod) => mod.runBench(map, firstFrameMs));
}
