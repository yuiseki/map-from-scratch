import { mount } from './trips.js';
const started = performance.now();
const canvas = document.getElementById('map');
const map = await mount(canvas, '../../../data/baked/deckgl-025-trips-layer/trips.bin', '../../../data/baked/deckgl-025-trips-layer/buildings.bin');
document.getElementById('status').textContent = `${map.trips.toLocaleString('ja-JP')} 経路 · ${map.buildings.toLocaleString('ja-JP')} 棟`;
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
const timeSlider = document.getElementById('time');
const timeValue = document.getElementById('time-value');
const showTime = (time)=>{
    const minutes = Math.floor(time / 60).toString().padStart(2, '0');
    const seconds = Math.floor(time % 60).toString().padStart(2, '0');
    timeValue.textContent = `21:${minutes}:${seconds}`;
    timeSlider.value = String(Math.floor(time));
};
const trailSlider = document.getElementById('trail');
trailSlider.addEventListener('input', ()=>{
    const n = Number(trailSlider.value);
    map.setTrail(n);
    document.getElementById('trail-value').textContent = `${n} 秒`;
});
if (new URLSearchParams(location.search).has('bench')) {
    await (await import('./bench.js')).run(map, firstFrameMs);
} else {
    const playButton = document.getElementById('play');
    let playing = true, raf = 0;
    let anchorNow = performance.now(), anchorTime = map.time;
    const tick = (now)=>{
        raf = 0;
        if (!playing || document.hidden) return;
        const t = (anchorTime + (now - anchorNow) / 60) % 1800;
        map.setTime(t);
        showTime(t);
        raf = requestAnimationFrame(tick);
    };
    const schedule = ()=>{
        if (!raf && playing && !document.hidden) raf = requestAnimationFrame(tick);
    };
    playButton.addEventListener('click', ()=>{
        playing = !playing;
        if (playing) {
            anchorNow = performance.now();
            anchorTime = map.time;
            schedule();
        } else if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        playButton.textContent = playing ? '一時停止' : '再生';
        playButton.setAttribute('aria-pressed', String(playing));
    });
    timeSlider.addEventListener('input', ()=>{
        const t = Number(timeSlider.value);
        map.setTime(t);
        showTime(t);
        anchorNow = performance.now();
        anchorTime = t;
    });
    document.addEventListener('visibilitychange', ()=>{
        if (document.hidden && raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        if (!document.hidden) {
            anchorNow = performance.now();
            anchorTime = map.time;
            schedule();
        }
    });
    schedule();
}
