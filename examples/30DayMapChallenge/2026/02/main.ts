import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-02';
try {
  const map = await mount(canvas, base);
  const stats = map.stats;
  document.getElementById('stats')!.textContent = `${stats.storms.toLocaleString()} storms · ${stats.observations.toLocaleString()} positions · ${stats.segments.toLocaleString()} segments`;
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map);
  }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;background:#400;padding:12px">${String(error)}</pre>`);
}
