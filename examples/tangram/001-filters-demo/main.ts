import { FiltersMap } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new FiltersMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;

document.querySelectorAll<HTMLInputElement>('input[data-type]').forEach((input) => {
  input.addEventListener('change', () => {
    map.setTypeVisible(input.dataset.type as 'SR' | 'US' | 'I', input.checked);
  });
});

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
