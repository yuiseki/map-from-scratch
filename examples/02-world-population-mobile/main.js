import { mount } from './map.js';
const info = document.getElementById('info');
const map = await mount(document.getElementById('map'), '../../data/baked/02-world-population-mobile', (c)=>{
    info.textContent = c ? `${c.name}  人口 ${c.population.toLocaleString('ja-JP')} 人` : '';
});
const mounted = performance.now();
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, mounted);
