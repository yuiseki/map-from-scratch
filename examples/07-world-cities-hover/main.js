import { mount } from './cities.js';
const tip = document.getElementById('tip');
let mx = 0, my = 0;
addEventListener('pointermove', (e)=>{
    mx = e.clientX;
    my = e.clientY;
    tip.style.transform = `translate(${mx + 14}px,${my + 14}px)`;
});
const map = await mount(document.getElementById('map'), '../../data/baked/07-world-cities-hover', (c)=>{
    tip.textContent = c ? `${c.name} (${c.country})  人口 ${c.population ? String(c.population).replace(/\B(?=(\d{3})+$)/g, ',') + ' 人' : '不明'}` : '';
});
const mounted = performance.now();
if (location.search.includes('bench')) (await import('./bench.js')).run(map, tip, mounted);
