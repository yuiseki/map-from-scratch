import { mount } from './marker.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(canvas, '../../../data/baked/maplibre-048-create-a-draggable-marker/land.json');

const firstFrameMs = performance.now() - started;

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
