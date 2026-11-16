import { mount } from './renderer.js';
const canvas = document.getElementById('map');
const base = '../../../../data/baked/30DayMapChallenge-2026-23';
try {
    const renderer = await mount(canvas, base);
    for (const input of document.querySelectorAll('input[data-category]')){
        input.addEventListener('change', ()=>renderer.setCategory(input.dataset.category, input.checked));
    }
    document.getElementById('zoom-in').addEventListener('click', ()=>renderer.setZoom(1.35));
    document.getElementById('zoom-out').addEventListener('click', ()=>renderer.setZoom(1 / 1.35));
    document.getElementById('reset').addEventListener('click', ()=>renderer.resetView());
    document.getElementById('map').addEventListener('focus', ()=>document.body.classList.add('map-focused'));
    document.getElementById('map').addEventListener('blur', ()=>document.body.classList.remove('map-focused'));
    if (new URLSearchParams(location.search).has('bench')) {
        const { run } = await import('./bench.js');
        await run(renderer);
    }
} catch (error) {
    console.error(error);
    document.getElementById('map-status').textContent = `地図データの読み込みに失敗しました: ${String(error)}`;
}
