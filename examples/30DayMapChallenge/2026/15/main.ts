import { mount, type SectionMap } from './renderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const selected = document.getElementById('selected')!;
let map: SectionMap;
try {
  map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-15');
  status.textContent = `${map.stats.sourceCells.toLocaleString()} cells · ${map.stats.elevationMinM.toLocaleString()} to ${map.stats.elevationMaxM.toLocaleString()} m · ${map.stats.eventCount} earthquakes`;
  document.getElementById('exaggeration')!.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value); map.setExaggeration(value);
    document.getElementById('exag-label')!.textContent = `${value}×`;
  });
  canvas.addEventListener('hypocenter-select', (event) => {
    const index = (event as CustomEvent<{ index: number }>).detail.index;
    if (index < 0) { selected.textContent = '震源を選択すると USGS ComCat のイベントを表示します。'; return; }
    const quake = map.data.events[index]!;
    selected.replaceChildren();
    const text = document.createElement('span'); text.textContent = `${quake.id} · M${quake.magnitude.toFixed(1)} · 深さ ${quake.depthKm.toFixed(1)} km · `;
    const link = document.createElement('a'); link.href = `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(quake.id)}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'USGS event';
    selected.append(text, link);
  });
  const response = await fetch('./PROMPT.md'); if (response.ok) document.getElementById('prompt')!.textContent = await response.text();
  if (new URLSearchParams(location.search).has('bench')) { const { run } = await import('./bench.ts'); await run(map); }
} catch (error) { status.textContent = `読み込みエラー: ${String(error)}`; console.error(error); }
