import { GridTileMap } from './tiles.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new GridTileMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;
const addr = document.getElementById('addr');
const attr = document.getElementById('attr');
attr.textContent = map.attribution;
let hover = {
    x: canvas.clientWidth / 2,
    y: canvas.clientHeight / 2
};
const showAddress = ()=>{
    addr.textContent = map.tileAddressAt(hover.x, hover.y) ?? '—';
};
canvas.addEventListener('pointermove', (e)=>{
    const rect = canvas.getBoundingClientRect();
    hover = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    showAddress();
});
map.onDraw = showAddress;
showAddress();
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
