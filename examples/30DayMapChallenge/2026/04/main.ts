import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-04';
try {
  const map = await mount(canvas, base);
  const counts = document.getElementById('counts')!;
  const filters = [...document.querySelectorAll<HTMLButtonElement>('button[data-filter]')];
  function updateCount() {
    const kind = map.state.filter;
    const total = kind < 0 ? map.stats.sourceFeatures : map.stats.categoryCounts[kind]!;
    const name = kind < 0 ? '全施設' : map.stats.categoryNames[kind]!;
    counts.textContent = `${name} · ${total.toLocaleString()} 点`;
  }
  filters.forEach((button) => button.addEventListener('click', () => {
    map.state.filter = Number(button.dataset.filter);
    filters.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    updateCount(); map.draw();
  }));
  updateCount();
  document.getElementById('stats')!.textContent = `OSM · ${map.stats.sourceFeatures.toLocaleString()} locations · 23 wards`;
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(map, filters.length - 1);
  }
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:auto 16px 16px;background:#400;padding:12px">${String(error)}</pre>`);
}
