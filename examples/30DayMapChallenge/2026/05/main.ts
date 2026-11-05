import { mount } from './renderer.ts';

const canvas = document.getElementById('terrain') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-05';
try {
  const map = await mount(canvas, base);
  const verticalExaggeration = map.verticalScale / 2 / ((map.stats.maximumMean - map.stats.minimumMean) / (map.stats.bounds.maxX - map.stats.bounds.minX));
  document.getElementById('minimum')!.textContent = `${map.stats.minimumMean.toLocaleString('ja-JP', { maximumFractionDigits: 0 })} m`;
  document.getElementById('maximum')!.textContent = `${map.stats.maximumMean.toLocaleString('ja-JP', { maximumFractionDigits: 0 })} m`;
  document.getElementById('vertical')!.textContent = `垂直誇張 約 ${verticalExaggeration.toFixed(1)}× · ${map.width.toLocaleString()} × ${map.height.toLocaleString()} cells`;
  document.getElementById('reset')!.addEventListener('click', map.reset);
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;background:#400;padding:12px">${String(error)}</pre>`);
}
