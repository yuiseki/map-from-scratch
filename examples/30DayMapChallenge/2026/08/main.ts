import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
try {
  const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-08');
  const { data } = map;
  const both = data.cells.filter((cell) => cell.walkableToPark && cell.walkableToSchool).length;
  document.getElementById('counts')!.textContent = `${data.cells.length.toLocaleString()} 区画 · ${both.toLocaleString()} 区画は公園と学校の両方が400 m以内`;
  document.getElementById('sources')!.textContent = `公園 ${data.parks.length} · 学校 ${data.schools.length} · 2020年人口`;
  if (new URLSearchParams(location.search).has('bench')) { const { run } = await import('./bench.ts'); await run(map); }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre class="error">${String(error)}</pre>`);
}
