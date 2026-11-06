import { CesiumPinsGlobe } from './globe.js';
const canvas = document.getElementById('globe');
const globe = new CesiumPinsGlobe(canvas);
window.__globe = globe;
const t0 = performance.now();
globe.load().then(()=>{
    const firstFrameMs = performance.now() - t0;
    if (location.search.includes('bench')) {
        import('./bench.js').then((b)=>b.run(globe, firstFrameMs));
    }
});
