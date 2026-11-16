import { depthLabel, mount } from './renderer.ts';
import type { FloodFeature } from './flood.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const dataBase = '../../../../data/baked/30DayMapChallenge-2026-26';
const selected = document.getElementById('selected')!;

function showFeature(feature: FloodFeature | null) {
  if (!feature) {
    selected.replaceChildren();
    const heading = document.createElement('strong'); heading.textContent = '浸水想定ポリゴンを選択してください';
    const detail = document.createElement('span'); detail.textContent = 'ポリゴンがない場所は、深さ0 mや安全を意味しません。';
    selected.append(heading, detail);
    return;
  }
  const rows = [
    [`${feature.river} · ${feature.manager}`, 'strong'],
    ['シナリオ: 想定最大規模', 'span'],
    [`出典カテゴリ: A31a_201..A31a_205 · 元の浸水深ランク ${feature.rawDepth ?? 'unknown'} · ${depthLabel(feature.rawDepth)}`, 'span'],
    [feature.id, 'code'],
  ] as const;
  selected.replaceChildren(...rows.map(([text, tag]) => {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }));
}

try {
  const renderer = await mount(canvas, `${dataBase}/flood.json`, (feature) => showFeature(feature));
  showFeature(null);
  for (const [id, factor] of [['zoom-in', 1.3], ['zoom-out', 1 / 1.3]] as const) {
    document.getElementById(id)!.addEventListener('click', () => renderer.zoomBy(factor));
  }
  document.getElementById('reset')!.addEventListener('click', () => renderer.resetView());
  document.getElementById('scenario')!.textContent = `想定最大規模 · 荒川 · ${renderer.data.features.length.toLocaleString()} clipped polygons`;
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts');
    await run(renderer);
  }
} catch (error) {
  console.error(error);
  document.getElementById('notice')!.textContent = `Flood data could not be loaded: ${String(error)}`;
}
