import { mount } from './popup.js';
const canvas = document.getElementById('map');
const t0 = performance.now();
mount(canvas).then((map)=>{
    window.__map = map;
    const firstFrameMs = performance.now() - t0;
    if (location.search.includes('bench')) {
        import('./bench.js').then((b)=>b.run(map, firstFrameMs));
    }
});
