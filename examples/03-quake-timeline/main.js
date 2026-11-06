import { mount } from './quake.js';
const base = '../../data/baked/03-quake-timeline';
const map = await mount(document.getElementById('map'), base);
const T0 = Date.UTC(2025, 0, 1);
const $ = (id)=>document.getElementById(id);
let list = null;
fetch(`${base}/quakes.json`).then((r)=>r.json()).then((l)=>{
    list = l;
    show();
});
function show() {
    const now = T0 + map.state.time * 60000;
    $('when').textContent = new Date(now).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    if (!list) return;
    let best = null;
    for(let i = 0; i < list.length && list[i][0] <= now; i++){
        if (now - list[i][0] <= map.state.fade * 60000 && (!best || list[i][1] > best[1])) best = list[i];
    }
    $('big').textContent = best ? `M${best[1]} ${best[2]}` : '';
}
const setTime = (t)=>{
    map.state.time = t;
    $('slider').value = String(t);
    show();
    map.render();
};
$('slider').addEventListener('input', (e)=>setTime(Number(e.target.value)));
let playing = false, last = 0;
const tick = (ts)=>{
    if (!playing) return;
    if (last) setTime((map.state.time + (ts - last) * 1.44) % 525600);
    last = ts;
    requestAnimationFrame(tick);
};
$('play').addEventListener('click', ()=>{
    playing = !playing;
    $('play').textContent = playing ? '一時停止' : '再生';
    last = 0;
    if (playing) requestAnimationFrame(tick);
});
show();
const mounted = performance.now();
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, setTime, mounted);
