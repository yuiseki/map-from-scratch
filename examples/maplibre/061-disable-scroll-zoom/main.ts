import { mount } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/maplibre-061-disable-scroll-zoom/land.json',
);

const firstFrameMs = performance.now() - started;

const toggleBtn = document.getElementById('toggle-scroll-zoom') as HTMLButtonElement;
const statusText = document.getElementById('status-text');

if (toggleBtn && statusText) {
  toggleBtn.addEventListener('click', () => {
    const next = !map.scrollZoomEnabled;
    map.setScrollZoom(next);
    toggleBtn.textContent = next ? 'Disable Scroll Zoom' : 'Enable Scroll Zoom';
    statusText.textContent = `Scroll zoom: ${next ? 'enabled' : 'disabled'}`;
  });
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
