import { mount } from './line.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/maplibre-012-add-a-geojson-line/route.json',
  '../../../data/baked/maplibre-012-add-a-geojson-line/land.json',
);

const firstFrameMs = performance.now() - started;

const colorBtns = document.querySelectorAll<HTMLButtonElement>('[data-color]');
colorBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color || '#888888';
    map.setLineStyle(color, map.lineWidth);
  });
});

const widthBtns = document.querySelectorAll<HTMLButtonElement>('[data-width]');
widthBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const width = Number(btn.dataset.width) || 8;
    map.setLineStyle(map.lineColor, width);
  });
});

const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    map.setZoom(15);
  });
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
