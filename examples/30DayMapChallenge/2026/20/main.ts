import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const selection = document.getElementById('selection')!;
const datasetCount = document.getElementById('dataset-count')!;
const base = '../../../../data/baked/30DayMapChallenge-2026-20';

try {
  const renderer = await mount(canvas, base);
  datasetCount.textContent = `${renderer.data.cells.length.toLocaleString('ja-JP')}セル · H3解像度4 · 推計総人口 ${renderer.data.populationTotal.toLocaleString('ja-JP')}人`;
  canvas.addEventListener('hex-select', (event) => {
    const cell = (event as CustomEvent<{ cell: { h3: string; population: number } | null }>).detail.cell;
    selection.textContent = cell ? `H3 ${cell.h3}  ·  人口推計 ${cell.population.toLocaleString('ja-JP')}人` : 'この位置にセルはありません。地球をドラッグして回転できます。';
  });
  document.getElementById('zoom-in')!.addEventListener('click', () => renderer.zoomBy(-120));
  document.getElementById('zoom-out')!.addEventListener('click', () => renderer.zoomBy(120));
  document.getElementById('reset')!.addEventListener('click', () => renderer.reset());
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer);
  }
} catch (error) {
  datasetCount.textContent = `読み込みエラー: ${String(error)}`;
  console.error(error);
}
