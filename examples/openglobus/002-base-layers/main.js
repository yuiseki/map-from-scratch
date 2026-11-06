import { BaseLayerMap } from './map.js';
const canvas = document.getElementById('map');
const map = new BaseLayerMap(canvas);
window.__map = map;
const btnOsm = document.getElementById('btn-osm');
const btnSat = document.getElementById('btn-sat');
btnOsm?.addEventListener('click', ()=>{
    map.setLayer('osm');
    btnOsm.classList.add('active');
    btnSat.classList.remove('active');
});
btnSat?.addEventListener('click', ()=>{
    map.setLayer('satellite');
    btnSat.classList.add('active');
    btnOsm.classList.remove('active');
});
const t0 = performance.now();
map.load().then(()=>{
    const firstFrameMs = performance.now() - t0;
    if (location.search.includes('bench')) {
        import('./bench.js').then((b)=>b.run(map, firstFrameMs));
    }
});
