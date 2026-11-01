// examples/maplibre/037-animate-map-camera-around-a-point/main.ts
import { mount } from './rotate.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const landUrl = new URL('../../../data/baked/maplibre-037-animate-map-camera-around-a-point/land.json', import.meta.url).href;

const map = await mount(canvas, landUrl);
const firstFrameMs = performance.now() - started;

const bearingDisplay = document.getElementById('bearing-display')!;
const btnToggle = document.getElementById('btn-toggle')!;
const btnReset = document.getElementById('btn-reset')!;

let active = true;
map.start();

setInterval(() => {
  bearingDisplay.textContent = `Bearing: ${map.getBearing().toFixed(1)}°`;
}, 100);

btnToggle.addEventListener('click', () => {
  active = !active;
  btnToggle.textContent = active ? 'Pause' : 'Play';
  if (active) map.start();
  else map.stop();
});

btnReset.addEventListener('click', () => {
  map.reset();
  bearingDisplay.textContent = `Bearing: 0.0°`;
});

// Benchmark runner attachment
if (window.location.search.includes('bench')) {
  map.stop();
  map.reset();
  import('./bench.ts').then((mod) => mod.runBench(map, firstFrameMs));
}
