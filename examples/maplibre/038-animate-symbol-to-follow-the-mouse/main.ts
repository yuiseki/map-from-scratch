// examples/maplibre/038-animate-symbol-to-follow-the-mouse/main.ts
import { mount } from './mouse.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const landUrl = new URL('../../../data/baked/maplibre-038-animate-symbol-to-follow-the-mouse/land.json', import.meta.url).href;

const map = await mount(canvas, landUrl);
const firstFrameMs = performance.now() - started;

const coordsDisplay = document.getElementById('coords-display')!;

// Update coordinate HUD on mouse movement
canvas.addEventListener('mousemove', () => {
  const [lon, lat] = map.getCursorLngLat();
  coordsDisplay.textContent = `Longitude: ${lon.toFixed(3)}, Latitude: ${lat.toFixed(3)}`;
});

// Benchmark runner attachment
if (window.location.search.includes('bench')) {
  import('./bench.ts').then((mod) => mod.runBench(map, firstFrameMs));
}
