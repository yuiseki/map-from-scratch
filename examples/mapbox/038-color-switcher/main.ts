import { mount } from './palette.ts';
import type { PaletteId } from './palette.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(
  canvas,
  '../../../data/baked/mapbox-038-color-switcher/box.json',
  '../../../data/baked/mapbox-038-color-switcher/land.json',
);

const firstFrameMs = performance.now() - started;

const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-palette]'));
for (const btn of buttons) {
  btn.addEventListener('click', () => {
    map.setPalette(btn.dataset.palette as PaletteId);
    for (const b of buttons) b.classList.toggle('active', b === btn);
  });
}
document.querySelector<HTMLButtonElement>('[data-palette="blue"]')?.classList.add('active');

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
