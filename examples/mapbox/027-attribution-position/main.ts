import { mount } from './attribution.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/mapbox-027-attribution-position/land.json',
);

const firstFrameMs = performance.now() - started;

for (const p of ['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const) {
  document.getElementById(`pos-${p}`)?.addEventListener('click', () => map.setPosition(p));
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
