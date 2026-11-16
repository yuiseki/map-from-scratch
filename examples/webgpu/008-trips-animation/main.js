import { createRenderer } from './render.js';
import { parseBuildingBuffer, parseTripsBuffer } from '../../deckgl/025-trips-layer/trips-data.js';
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const detail = document.getElementById('detail');
const playBtn = document.getElementById('play-btn');
const timeInput = document.getElementById('time');
const timeVal = document.getElementById('time-val');
const trailInput = document.getElementById('trail');
const trailVal = document.getElementById('trail-val');
const widthInput = document.getElementById('width');
const widthVal = document.getElementById('width-val');
let renderer;
try {
    renderer = await createRenderer(canvas);
} catch (error) {
    status.textContent = String(error);
    status.style.color = '#ff8080';
    throw error;
}
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const camera = {
    x: (-73.99 + 180) / 360,
    y: mercY(40.735),
    zoom: 13.5,
    pitch: 48,
    bearing: 15,
    width: 1,
    height: 1,
    time: 900,
    trail: 180,
    trailWidth: 2.2
};
let isPlaying = true;
let frozen = false;
let lastFrameTime = performance.now();
const SPEED = 25.0;
const MAX_TIME = 1800;
function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
function frame(now) {
    if (frozen) return;
    const dt = Math.min(0.1, (now - lastFrameTime) * 0.001);
    lastFrameTime = now;
    if (isPlaying) {
        camera.time = (camera.time + dt * SPEED) % MAX_TIME;
        timeInput.value = camera.time.toFixed(0);
        timeVal.textContent = formatTime(camera.time);
    }
    camera.width = canvas.clientWidth;
    camera.height = canvas.clientHeight;
    renderer.draw(camera);
    requestAnimationFrame(frame);
}
async function loadBuildings(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`buildings HTTP ${res.status}`);
    return parseBuildingBuffer(await res.arrayBuffer());
}
async function loadTrips(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`trips HTTP ${res.status}`);
    return parseTripsBuffer(await res.arrayBuffer(), 0x33305054, 10);
}
playBtn.addEventListener('click', ()=>{
    isPlaying = !isPlaying;
    playBtn.textContent = isPlaying ? '一時停止' : '再生';
    detail.innerHTML = `<strong>${isPlaying ? '再生中' : '一時停止中'}</strong>`;
});
timeInput.addEventListener('input', ()=>{
    camera.time = Number(timeInput.value);
    timeVal.textContent = formatTime(camera.time);
});
trailInput.addEventListener('input', ()=>{
    camera.trail = Number(trailInput.value);
    trailVal.textContent = `${camera.trail}秒`;
});
widthInput.addEventListener('input', ()=>{
    camera.trailWidth = Number(widthInput.value);
    widthVal.textContent = `${camera.trailWidth.toFixed(1)}px`;
});
const PLACES = {
    overview: {
        x: (-73.98 + 180) / 360,
        y: mercY(40.75),
        zoom: 12.4,
        pitch: 42,
        bearing: -15
    },
    midtown: {
        x: (-73.985 + 180) / 360,
        y: mercY(40.756),
        zoom: 14.5,
        pitch: 52,
        bearing: 28
    },
    downtown: {
        x: (-74.008 + 180) / 360,
        y: mercY(40.712),
        zoom: 14.2,
        pitch: 55,
        bearing: -35
    }
};
for (const b of document.querySelectorAll('[data-place]')){
    b.addEventListener('click', ()=>{
        const p = PLACES[b.dataset.place ?? ''];
        if (p) Object.assign(camera, p);
    });
}
let drag = null;
canvas.addEventListener('pointerdown', (e)=>{
    drag = {
        x: e.clientX,
        y: e.clientY,
        right: e.button === 2 || e.shiftKey
    };
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e)=>{
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.right) {
        const bearing = camera.bearing * Math.PI / 180;
        const factor = 1 / (512 * Math.pow(2, camera.zoom)) * 1.5;
        camera.x -= (Math.cos(bearing) * dx - Math.sin(bearing) * dy) * factor;
        camera.y -= (Math.sin(bearing) * dx + Math.cos(bearing) * dy) * factor;
    } else {
        camera.bearing = (camera.bearing + dx * 0.35) % 360;
        camera.pitch = Math.max(10, Math.min(80, camera.pitch + dy * 0.3));
    }
});
canvas.addEventListener('pointerup', ()=>{
    drag = null;
});
canvas.addEventListener('pointercancel', ()=>{
    drag = null;
});
canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
canvas.addEventListener('wheel', (e)=>{
    e.preventDefault();
    camera.zoom = Math.max(11.0, Math.min(17.5, camera.zoom - e.deltaY * 0.0015));
}, {
    passive: false
});
let buildingsLoaded = false, tripsLoaded = false;
try {
    const t0 = performance.now();
    const [bData, tData] = await Promise.all([
        loadBuildings('../../../data/baked/deckgl-025-trips-layer/buildings.bin'),
        loadTrips('../../../data/baked/deckgl-025-trips-layer/trips.bin')
    ]);
    renderer.uploadBuildings(bData);
    renderer.uploadTrips(tData);
    buildingsLoaded = true;
    tripsLoaded = true;
    const elapsed = Math.round(performance.now() - t0);
    status.textContent = `${bData.objects} 棟の建物 · ${tData.objects} 本のタクシー経路 (${tData.segments.toLocaleString()} セグメント) [${elapsed} ms]`;
    detail.innerHTML = `<strong>再生中</strong><br>現在時刻: ${formatTime(camera.time)} (全30分)`;
    requestAnimationFrame(frame);
} catch (error) {
    status.textContent = `データ読み込みエラー: ${String(error)}`;
    status.style.color = '#ff8080';
}
if (new URLSearchParams(location.search).has('bench')) {
    void import('./bench.js').then(({ run })=>run({
            device: renderer.device,
            gpu: renderer.gpu,
            draw: renderer.draw,
            readScreen: renderer.readScreen,
            camera,
            ready: ()=>buildingsLoaded && tripsLoaded,
            freeze: ()=>{
                frozen = true;
                isPlaying = false;
            }
        }));
}
