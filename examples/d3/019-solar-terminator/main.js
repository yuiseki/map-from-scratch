import { SolarTerminatorMap } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = new SolarTerminatorMap(canvas);
window.__map = map;
await map.load();
const firstFrameMs = performance.now() - started;
const slider = document.getElementById('hour');
const readout = document.getElementById('readout');
const play = document.getElementById('play');
const pad = (n)=>String(Math.floor(n)).padStart(2, '0');
const update = ()=>{
    const sun = map.subsolar();
    const lat = sun.lat >= 0 ? `北緯 ${sun.lat.toFixed(1)}°` : `南緯 ${(-sun.lat).toFixed(1)}°`;
    const lon = sun.lon >= 0 ? `東経 ${sun.lon.toFixed(1)}°` : `西経 ${(-sun.lon).toFixed(1)}°`;
    slider.value = String(map.hour);
    readout.textContent = `2026-10-30 ${pad(map.hour)}:${pad(map.hour % 1 * 60)} UTC · 太陽直下点 ${lat} ${lon}`;
};
slider.addEventListener('input', ()=>{
    map.setUtcHour(Number(slider.value));
    update();
});
let playing = false;
let raf = 0;
const tick = ()=>{
    map.setUtcHour(map.hour + 0.08);
    update();
    if (playing) raf = requestAnimationFrame(tick);
};
play.addEventListener('click', ()=>{
    playing = !playing;
    play.textContent = playing ? '一時停止' : '日周運動を再生';
    if (playing) raf = requestAnimationFrame(tick);
    else cancelAnimationFrame(raf);
});
update();
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
}
