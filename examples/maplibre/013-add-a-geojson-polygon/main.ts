import { mount } from './polygon.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/maplibre-013-add-a-geojson-polygon/maine.json',
  '../../../data/baked/maplibre-013-add-a-geojson-polygon/land.json',
);

const firstFrameMs = performance.now() - started;

const colorBtns = document.querySelectorAll<HTMLButtonElement>('[data-color]');
colorBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color || '#008888';
    map.setPolygonStyle(color, map.fillOpacity);
  });
});

const opacityBtns = document.querySelectorAll<HTMLButtonElement>('[data-opacity]');
opacityBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const opacity = Number(btn.dataset.opacity) || 0.8;
    map.setPolygonStyle(map.fillColor, opacity);
  });
});

const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    map.setZoom(5);
  });
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
