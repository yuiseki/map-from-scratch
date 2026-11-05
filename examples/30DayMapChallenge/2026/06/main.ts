import { mount } from './renderer.ts';
const canvas = document.getElementById('map') as HTMLCanvasElement;
try {
  const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-06');
  document.getElementById('count')!.textContent = `${map.stats.countries} countries · ${map.stats.vertices.toLocaleString()} vertices`;
  if (new URLSearchParams(location.search).has('bench')) { const { run } = await import('./bench.ts'); await run(map); }
} catch (error) { console.error(error); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:16px;left:16px;background:#fff;padding:12px;color:#600">${String(error)}</pre>`); }
