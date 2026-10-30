import { mount } from './popup.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/maplibre-073-display-a-popup/land.json');
const firstFrameMs = performance.now() - started;
const reopenBtn = document.getElementById('reopen-popup');
if (reopenBtn) {
    reopenBtn.addEventListener('click', ()=>{
        map.setPopupVisible(true);
    });
}
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
