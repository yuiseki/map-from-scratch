// examples/maplibre/033-animate-a-point-along-a-route/main.ts
import { mount } from './route.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const landUrl = new URL('../../../data/baked/maplibre-033-animate-a-point-along-a-route/land.json', import.meta.url).href;
const routeUrl = new URL('../../../data/baked/maplibre-033-animate-a-point-along-a-route/route.json', import.meta.url).href;

const map = await mount(canvas, landUrl, routeUrl);
const firstFrameMs = performance.now() - started;

const stepCount = document.getElementById('step-count')!;
const btnToggle = document.getElementById('btn-toggle')!;
const btnReplay = document.getElementById('btn-replay')!;

let active = true;
map.start();

setInterval(() => {
  stepCount.textContent = `Progress: ${map.getStep()} / 500`;
}, 100);

btnToggle.addEventListener('click', () => {
  active = !active;
  btnToggle.textContent = active ? 'Pause' : 'Play';
  if (active) map.start();
  else map.stop();
});

btnReplay.addEventListener('click', () => {
  map.reset();
  if (!active) {
    active = true;
    btnToggle.textContent = 'Pause';
    map.start();
  }
});

// Benchmark runner attachment
if (window.location.search.includes('bench')) {
  map.stop();
  map.reset();
  import('./bench.ts').then((mod) => mod.runBench(map, firstFrameMs));
}
