import type { NullCell } from './nullmap.ts';
import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const selected = document.getElementById('selected')!;
const statsNode = document.getElementById('stats')!;
const base = '../../../../data/baked/30DayMapChallenge-2026-18';
const format = (value: number) => value.toLocaleString('ja-JP');

try {
  const renderer = await mount(canvas, base);
  const stats = renderer.stats as {
    counts: { lattice: number; sourceRowsInBounds: number; missing: number; suppressed: number; zero: number; positive: number };
    positiveValueRange: { min: number; max: number };
  };
  status.textContent = `${renderer.data.year}年国勢調査 · 250 m · 75歳以上女性`;
  document.getElementById('positive-count')!.textContent = format(stats.counts.positive);
  document.getElementById('zero-count')!.textContent = format(stats.counts.zero);
  document.getElementById('suppressed-count')!.textContent = format(stats.counts.suppressed);
  document.getElementById('missing-count')!.textContent = format(stats.counts.missing);
  statsNode.textContent = `${format(stats.counts.lattice)}格子 · 正値 ${stats.positiveValueRange.min}–${format(stats.positiveValueRange.max)}人 · 格子中心がAOI内の集計`;
  canvas.addEventListener('null-cell-select', (event) => {
    const detail = (event as CustomEvent<{ cell: NullCell | null }>).detail;
    if (!detail.cell) { selected.textContent = 'メッシュを選ぶと、公表状態と値を表示します。'; return; }
    const cell = detail.cell;
    const value = cell.status === 'positive' ? `${format(cell.value!)}人` : renderer.data.legend[cell.status];
    selected.textContent = `${cell.code} · ${value} · ${cell.longitude.toFixed(5)}, ${cell.latitude.toFixed(5)}`;
  });
  document.getElementById('zoom-in')!.addEventListener('click', () => renderer.setZoom(renderer.view.zoom * 1.5));
  document.getElementById('zoom-out')!.addEventListener('click', () => renderer.setZoom(renderer.view.zoom / 1.5));
  document.getElementById('reset')!.addEventListener('click', () => renderer.resetView());
  const prompt = await fetch('./PROMPT.md');
  if (prompt.ok) document.getElementById('prompt')!.textContent = await prompt.text();
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer);
  }
} catch (error) {
  status.textContent = `読み込みエラー: ${String(error)}`;
  console.error(error);
}
