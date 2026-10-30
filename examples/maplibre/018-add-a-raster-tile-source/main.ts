import { RasterTileMap, STYLES } from './tiles.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new RasterTileMap(canvas);
await map.load(STYLES[0].url);
const firstFrameMs = performance.now() - started;

const attr = document.getElementById('attr') as HTMLDivElement;
attr.textContent = map.attribution;

const buttons = document.querySelectorAll<HTMLButtonElement>('button[data-style]');
for (const btn of buttons) {
  btn.addEventListener('click', async () => {
    const style = STYLES.find((s) => s.id === btn.dataset.style);
    if (!style) return;
    for (const b of buttons) b.classList.remove('on');
    btn.classList.add('on');
    await map.setStyle(style.url);
    attr.textContent = map.attribution;
  });
}

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
