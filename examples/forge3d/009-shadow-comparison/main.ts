import { ShadowRelief } from './relief.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const relief = new ShadowRelief(canvas);
await relief.load();
const firstFrameMs = performance.now() - started;

const slider = document.getElementById('split') as HTMLInputElement;
const out = document.getElementById('splitOut') as HTMLOutputElement;
const showSplit = (): void => {
  const pct = Number(slider.value);
  relief.setSplit(pct / 100);
  out.textContent = `${pct}%`;
};
slider.addEventListener('input', showSplit);

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(relief, firstFrameMs);
}
