import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map-canvas');
const dataUrl = new URL('../../../data/baked/kepler-002-open-modal/earthquakes.bin', import.meta.url).href;
const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;
const modalOverlay = document.getElementById('modal-overlay');
const openBtn = document.getElementById('open-modal-btn');
const closeBtn = document.getElementById('close-modal-btn');
function openModal() {
    modalOverlay.classList.remove('hidden');
    requestAnimationFrame(()=>{
        map.resize();
    });
}
function closeModal() {
    modalOverlay.classList.add('hidden');
}
openBtn.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e)=>{
    if (e.target === modalOverlay) {
        closeModal();
    }
});
document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') {
        closeModal();
    }
});
if (new URLSearchParams(location.search).has('bench')) {
    const benchModule = await import('./bench.js');
    await benchModule.run(map, firstFrameMs);
}
