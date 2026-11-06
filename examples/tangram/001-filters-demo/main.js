import { FiltersMap } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new FiltersMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;
document.querySelectorAll('input[data-type]').forEach((input)=>{
    input.addEventListener('change', ()=>{
        map.setTypeVisible(input.dataset.type, input.checked);
    });
});
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
