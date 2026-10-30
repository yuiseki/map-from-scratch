import { GridTileMap } from './tiles.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new GridTileMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;

const addr = document.getElementById('addr') as HTMLSpanElement;
const attr = document.getElementById('attr') as HTMLDivElement;
attr.textContent = map.attribution;

let hover = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
const showAddress = (): void => {
  addr.textContent = map.tileAddressAt(hover.x, hover.y) ?? '—';
};
canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  showAddress();
});
// The grid moves under a still pointer when zooming, so refresh on redraw.
map.onDraw = showAddress;
showAddress();

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
