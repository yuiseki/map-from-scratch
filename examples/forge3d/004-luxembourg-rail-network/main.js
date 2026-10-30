import { LuxembourgRailMap } from './map.js';
const canvas = document.getElementById('map');
const map = new LuxembourgRailMap(canvas);
window.__map = map;
const t0 = performance.now();
map.load().then(()=>{
    const firstFrameMs = performance.now() - t0;
    if (location.search.includes('bench')) {
        import('./bench.js').then((b)=>b.run(map, firstFrameMs));
    }
});
