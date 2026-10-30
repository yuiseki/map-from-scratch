// examples/deckgl/001-arc-layer/main.ts
import { mount } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const countySelect = document.getElementById('county-select') as HTMLSelectElement;

const map = await mount(canvas, '../../../data/baked/deckgl-001-arc-layer/arcs.bin');
const firstFrameMs = performance.now() - started;

function updateStatus() {
  status.textContent = `${map.selectedCountyName} · 表示アーク ${map.activeArcCount.toLocaleString()} 本 (総フロー ${map.flowCount.toLocaleString()} 件 / 3,220 郡)`;
}

updateStatus();

countySelect.addEventListener('change', () => {
  const val = Number(countySelect.value);
  map.selectCounty(val);
  updateStatus();
});

if (new URLSearchParams(location.search).has('bench')) {
  const benchModule = await import('./bench.ts');
  await benchModule.run(map, firstFrameMs);
}
