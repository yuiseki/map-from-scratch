import { RasterTileMap, STYLES } from './tiles.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new RasterTileMap(canvas);
await map.load(STYLES[0].url);
const firstFrameMs = performance.now() - started;
const attr = document.getElementById('attr');
attr.textContent = map.attribution;
const buttons = document.querySelectorAll('button[data-style]');
for (const btn of buttons){
    btn.addEventListener('click', async ()=>{
        const style = STYLES.find((s)=>s.id === btn.dataset.style);
        if (!style) return;
        for (const b of buttons)b.classList.remove('on');
        btn.classList.add('on');
        await map.setStyle(style.url);
        attr.textContent = map.attribution;
    });
}
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
