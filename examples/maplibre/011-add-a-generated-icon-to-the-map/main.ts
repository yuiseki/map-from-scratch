import { mount } from './icon.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(canvas, '../../../data/baked/maplibre-011-add-a-generated-icon-to-the-map/land.json');

const firstFrameMs = performance.now() - started;

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
