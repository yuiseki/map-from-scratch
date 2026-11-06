import { ShadowRelief } from './relief.js';
const started = performance.now();
const canvas = document.getElementById('map');
const relief = new ShadowRelief(canvas);
await relief.load();
const firstFrameMs = performance.now() - started;
const slider = document.getElementById('split');
const out = document.getElementById('splitOut');
const showSplit = ()=>{
    const pct = Number(slider.value);
    relief.setSplit(pct / 100);
    out.textContent = `${pct}%`;
};
slider.addEventListener('input', showSplit);
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(relief, firstFrameMs);
}
