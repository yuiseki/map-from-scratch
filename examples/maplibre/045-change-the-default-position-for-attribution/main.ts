import { mount } from './attribution.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/maplibre-045-change-the-default-position-for-attribution/land.json',
);
const firstFrameMs = performance.now() - started;

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
