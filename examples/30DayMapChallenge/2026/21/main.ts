import { mount } from './renderer.ts';
import type { Category } from './osm.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const base = '../../../../data/baked/30DayMapChallenge-2026-21';
const byId = (id: string) => document.getElementById(id)!;
const categoryInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-category]')];

try {
  const renderer = await mount(canvas, base);
  const counts = new Map<Category, number>();
  for (const feature of renderer.features) counts.set(feature.category, (counts.get(feature.category) ?? 0) + 1);
  for (const [category, count] of counts) document.querySelector(`[data-count="${category}"]`)!.textContent = count.toLocaleString('ja-JP');
  for (const input of categoryInputs) {
    input.addEventListener('change', () => renderer.setCategory(input.dataset.category as Category, input.checked));
  }
  byId('zoom-in').addEventListener('click', () => renderer.zoomBy(1.25));
  byId('zoom-out').addEventListener('click', () => renderer.zoomBy(0.8));
  byId('reset').addEventListener('click', () => renderer.resetView());
  byId('feature-prev').addEventListener('click', () => renderer.selectNext(-1));
  byId('feature-next').addEventListener('click', () => renderer.selectNext(1));
  renderer.setCoordinateAt([canvas.clientWidth / 2, canvas.clientHeight / 2]);
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer);
  }
} catch (error) {
  console.error(error);
  byId('feature-info').textContent = `OSMデータを読み込めませんでした: ${String(error)}`;
}
