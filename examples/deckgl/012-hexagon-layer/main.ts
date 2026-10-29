import { mount } from './hexagons.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = await mount(canvas, '../../../data/baked/deckgl-012-hexagon-layer/points.bin');
const status = document.getElementById('status')!;
const updateStatus = () => { status.textContent = `${map.points.toLocaleString('ja-JP')} 件 · ${map.cells.toLocaleString('ja-JP')} 六角セル`; };
updateStatus();
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;

const radius = document.getElementById('radius') as HTMLInputElement;
radius.addEventListener('input', () => {
  const n = Number(radius.value);
  map.setRadius(n);
  document.getElementById('radius-value')!.textContent = `${n.toLocaleString('ja-JP')} m`;
  updateStatus();
});
const coverage = document.getElementById('coverage') as HTMLInputElement;
coverage.addEventListener('input', () => {
  const n = Number(coverage.value) / 100;
  map.setCoverage(n);
  document.getElementById('coverage-value')!.textContent = n.toFixed(2);
});
const percentile = document.getElementById('percentile') as HTMLInputElement;
percentile.addEventListener('input', () => {
  const n = Number(percentile.value);
  map.setUpperPercentile(n);
  document.getElementById('percentile-value')!.textContent = `${n}%`;
});
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(map, firstFrameMs);
