import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-03';
try {
  const map = await mount(canvas, base), { stats } = map;
  document.getElementById('min-pop')!.textContent = `${stats.minimum.toLocaleString()} people`;
  document.getElementById('max-pop')!.textContent = `${stats.maximum.toLocaleString()} people`;
  document.getElementById('stats')!.textContent = `${stats.countriesWithValues} countries · ${stats.polygons} polygons`;
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;background:#400;padding:12px">${String(error)}</pre>`);
}
