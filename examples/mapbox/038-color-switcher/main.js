import { mount } from './palette.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/mapbox-038-color-switcher/box.json', '../../../data/baked/mapbox-038-color-switcher/land.json');
const firstFrameMs = performance.now() - started;
const buttons = Array.from(document.querySelectorAll('[data-palette]'));
for (const btn of buttons){
    btn.addEventListener('click', ()=>{
        map.setPalette(btn.dataset.palette);
        for (const b of buttons)b.classList.toggle('active', b === btn);
    });
}
document.querySelector('[data-palette="blue"]')?.classList.add('active');
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
