import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map-canvas');
const dataUrl = new URL('../../../data/baked/kepler-008-custom-map-style/earthquakes.bin', import.meta.url).href;
const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;
const styleCards = document.querySelectorAll('.style-card');
const legendGradient = document.getElementById('legend-gradient');
const GRADIENTS = {
    dark: 'linear-gradient(to right, #fae037, #b81c70)',
    light: 'linear-gradient(to right, #2563eb, #dc2626)',
    navy: 'linear-gradient(to right, #06b6d4, #f43f5e)',
    desert: 'linear-gradient(to right, #f59e0b, #b91c1c)'
};
styleCards.forEach((card)=>{
    card.addEventListener('click', ()=>{
        styleCards.forEach((c)=>c.classList.remove('active'));
        card.classList.add('active');
        const styleKey = card.getAttribute('data-style') || 'dark';
        map.setStyle(styleKey);
        if (GRADIENTS[styleKey]) {
            legendGradient.style.background = GRADIENTS[styleKey];
        }
    });
});
const toggleLand = document.getElementById('toggle-land');
toggleLand.addEventListener('change', ()=>{
    map.setLayerVisibility('land', toggleLand.checked);
});
const toggleBorders = document.getElementById('toggle-borders');
toggleBorders.addEventListener('change', ()=>{
    map.setLayerVisibility('borders', toggleBorders.checked);
});
const togglePoints = document.getElementById('toggle-points');
togglePoints.addEventListener('change', ()=>{
    map.setLayerVisibility('points', togglePoints.checked);
});
if (window.location.search.includes('bench')) {
    import('./bench.js').then((mod)=>mod.runBench(map, firstFrameMs));
}
