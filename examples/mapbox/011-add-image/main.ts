import { mount } from './image-overlay.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/mapbox-011-add-image/land.json',
  '../../../data/baked/mapbox-011-add-image/overlay.png',
);
const firstFrameMs = performance.now() - started;

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
