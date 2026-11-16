import { mount } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const selected = document.getElementById('selected')!;
const visibleSelection = document.getElementById('selected-visible')!;
const status = document.getElementById('status')!;
const statsNode = document.getElementById('stats')!;
const base = '../../../../data/baked/30DayMapChallenge-2026-17';

try {
  const renderer = await mount(canvas, base);
  status.textContent = '2021年12月 · 平日・休日を含む全日';
  const stats = renderer.stats as {
    geometryCount: number; daytimeRecords: number; lateNightRecords: number;
    daytimePopulationTotal: number; lateNightPopulationTotal: number; sharedMaximum: number;
  };
  statsNode.textContent = `1 kmメッシュ ${stats.geometryCount.toLocaleString('ja-JP')} · 昼 ${stats.daytimeRecords.toLocaleString('ja-JP')}件 · 深夜 ${stats.lateNightRecords.toLocaleString('ja-JP')}件 · 共通上限 ${stats.sharedMaximum.toLocaleString('ja-JP')}人`;
  canvas.addEventListener('presence-select', (event) => {
    const detail = (event as CustomEvent<{ mesh: { id: string; daytime: number | null; lateNight: number | null } | null }>).detail;
    if (!detail.mesh) { selected.textContent = '地図のメッシュを選ぶと、同じ場所の昼間と深夜の公表値を並べて表示します。'; visibleSelection.textContent = selected.textContent; return; }
    const format = (value: number | null) => value === null ? '未公表 / 値なし' : `${value.toLocaleString('ja-JP')} 人`;
    selected.textContent = `メッシュ ${detail.mesh.id}　昼間 ${format(detail.mesh.daytime)}　深夜 ${format(detail.mesh.lateNight)}`;
    visibleSelection.textContent = selected.textContent;
  });
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
