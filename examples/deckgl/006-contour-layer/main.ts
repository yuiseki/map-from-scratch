import { mount } from './contours.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const land = document.getElementById('land') as HTMLCanvasElement;
const map = await mount(canvas, land,
  '../../../data/baked/deckgl-006-contour-layer/counties.bin',
  '../../../data/baked/deckgl-006-contour-layer/land.json');
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
const status = document.getElementById('status')!;
status.textContent = `${map.count.toLocaleString('ja-JP')} 郡 · ${map.nonzero.toLocaleString('ja-JP')} セルに値あり`;
const dateOf = (week: number) => new Date(Date.UTC(2020, 0, 20 + week * 7)).toISOString().slice(0, 10);
const week = document.getElementById('week') as HTMLInputElement;
week.addEventListener('input', () => {
  map.setWeek(Number(week.value));
  document.getElementById('week-value')!.textContent = dateOf(map.week);
  status.textContent = `${map.count.toLocaleString('ja-JP')} 郡 · ${map.nonzero.toLocaleString('ja-JP')} セルに値あり`;
});
const cell = document.getElementById('cell') as HTMLInputElement;
cell.addEventListener('input', () => {
  map.setCellSize(Number(cell.value));
  document.getElementById('cell-value')!.textContent = `${(map.cellSize / 1000).toFixed(0)} km`;
  status.textContent = `${map.count.toLocaleString('ja-JP')} 郡 · ${map.nonzero.toLocaleString('ja-JP')} セルに値あり`;
});
const style = document.getElementById('style') as HTMLSelectElement;
style.addEventListener('change', () => map.setStyle(style.value === 'lines' ? 'lines' : 'bands'));
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(map, firstFrameMs);
