import { mount } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/maplibre-069-display-a-map/land.json',
);

const firstFrameMs = performance.now() - started;

const zoomInBtn = document.getElementById('zoom-in');
if (zoomInBtn) {
  zoomInBtn.addEventListener('click', () => map.setZoom(map.zoom + 1));
}

const zoomOutBtn = document.getElementById('zoom-out');
if (zoomOutBtn) {
  zoomOutBtn.addEventListener('click', () => map.setZoom(map.zoom - 1));
}

const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    map.panBy((map.center[0] - 0.5) * 512, (map.center[1] - 0.5) * 512);
    map.setZoom(1);
  });
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
