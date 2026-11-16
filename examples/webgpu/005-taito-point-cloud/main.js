import { decodePcpng } from '../../23-taito-point-cloud/decode.js';
import { createRenderer } from './render.js';
import { fallbackTiles, planTiles } from '../../23-taito-point-cloud/tiles.js';
const SOURCE = 'https://tiles.gsj.jp/tiles/pcpng/mixed/tiles';
const lon0 = 139.795922, lat0 = 35.711917;
const world = 40075016.68557849 * Math.cos(lat0 * Math.PI / 180);
const mercator = (lon, lat)=>[
        (lon + 180) / 360,
        (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2
    ];
const [mx0, my0] = mercator(lon0, lat0);
const origin = {
    x: mx0 * world,
    y: my0 * world,
    scale: world
};
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const detail = document.getElementById('detail');
let renderer;
try {
    renderer = await createRenderer(canvas);
} catch (error) {
    status.textContent = String(error);
    status.style.color = '#ff8080';
    throw error;
}
const isBench = new URLSearchParams(location.search).has('bench');
let tileRadius = isBench ? 2 : 3;
const camera = {
    x: 0,
    y: 0,
    distance: 780,
    yaw: 22,
    pitch: 62,
    width: 1,
    height: 1,
    size: 3.2
};
const tiles = new Map();
let pending = 0, prefetchPending = 0, requests = 0, bytes = 0, points = 0, gpuBytes = 0, lastError = '', scheduled = false;
let previousDistance = camera.distance;
let zoomIn = true;
let visibleTiles = [];
let frozen = false;
const key = (z, x, y)=>`${z}/${x}/${y}`;
function tile(z, x, y) {
    const id = key(z, x, y);
    let found = tiles.get(id);
    if (!found) {
        found = {
            z,
            x,
            y,
            mesh: null,
            loading: false,
            failed: false,
            used: 0
        };
        tiles.set(id, found);
    }
    return found;
}
function schedule() {
    if (scheduled || frozen) return;
    scheduled = true;
    requestAnimationFrame(()=>{
        scheduled = false;
        draw();
    });
}
async function load(t, background) {
    t.loading = true;
    pending++;
    if (background) prefetchPending++;
    try {
        const response = await fetch(`${SOURCE}/${t.z}/${t.x}/${t.y}.webp`);
        if (response.status === 404) {
            t.failed = true;
            return;
        }
        if (!response.ok) throw new Error(`点群タイル HTTP ${response.status}`);
        const blob = await response.blob();
        bytes += blob.size;
        requests++;
        const bitmap = await createImageBitmap(blob, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none'
        });
        const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = offscreen.getContext('2d', {
            willReadFrequently: true
        });
        if (!context) throw new Error('画像を読み取れません');
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const image = context.getImageData(0, 0, offscreen.width, offscreen.height);
        const cloud = decodePcpng(image.data, image.width, image.height, origin);
        t.mesh = renderer.upload(cloud);
        points += cloud.count;
        gpuBytes += t.mesh.bytes;
    } catch (error) {
        t.failed = true;
        lastError = String(error);
    } finally{
        t.loading = false;
        pending--;
        if (background) prefetchPending--;
        schedule();
    }
}
function draw() {
    camera.width = canvas.clientWidth;
    camera.height = canvas.clientHeight;
    const z = Math.max(14, Math.min(20, Math.round(20 - Math.log2(camera.distance / 130))));
    if (camera.distance !== previousDistance) zoomIn = camera.distance < previousDistance;
    const plan = planTiles(z, mx0 + camera.x / world, my0 - camera.y / world, zoomIn, tileRadius);
    previousDistance = camera.distance;
    const wanted = plan.visible.map(({ z, x, y })=>tile(z, x, y));
    visibleTiles = wanted;
    const prefetch = plan.prefetch.map(({ z, x, y })=>tile(z, x, y));
    const now = performance.now();
    for (const t of [
        ...wanted,
        ...prefetch
    ])t.used = now;
    const maxPending = tileRadius >= 3 ? 8 : 5;
    for (const t of wanted){
        if (pending >= maxPending) break;
        if (!t.mesh && !t.loading && !t.failed) void load(t, false);
    }
    if (wanted.every((t)=>t.mesh || t.failed)) {
        for (const t of prefetch){
            if (pending >= maxPending || prefetchPending >= 3) break;
            if (!t.mesh && !t.loading && !t.failed) void load(t, true);
        }
    }
    const shown = wanted.filter((t)=>t.mesh).map((t)=>t.mesh);
    const fallback = fallbackTiles(wanted.filter((t)=>!t.mesh), (level, x, y)=>!!tiles.get(key(level, x, y))?.mesh).map(({ z, x, y })=>tiles.get(key(z, x, y)));
    for (const t of fallback)t.used = now;
    renderer.draw(camera, [
        ...fallback.map((t)=>t.mesh),
        ...shown
    ]);
    const maxGpuBytes = (tileRadius >= 4 ? 480 : tileRadius >= 3 ? 320 : 120) * 1048576;
    const targetGpuBytes = maxGpuBytes * 0.75;
    if (gpuBytes > maxGpuBytes) {
        for (const t of [
            ...tiles.values()
        ].filter((t)=>t.mesh && t.used !== now).sort((a, b)=>a.used - b.used)){
            if (gpuBytes < targetGpuBytes) break;
            gpuBytes -= t.mesh.bytes;
            points -= t.mesh.count;
            renderer.remove(t.mesh);
            t.mesh = null;
        }
    }
    const side = tileRadius * 2 + 1;
    const loadedCount = shown.length;
    detail.textContent = `表示: ${side}×${side} (${loadedCount}/${wanted.length}タイル) | ズーム: z${z} | 点数: ${points.toLocaleString()} 点 | GPU: ${(gpuBytes / 1048576).toFixed(1)} MiB`;
    status.textContent = pending > 0 ? `取得中: ${pending} 件 (受信 ${(bytes / 1048576).toFixed(1)} MB)` : lastError ? `エラー: ${lastError}` : `準備完了 (${requests} リクエスト)`;
}
const PLACES = {
    overview: {
        x: 0,
        y: -200,
        distance: 3200,
        yaw: 15,
        pitch: 56
    },
    asakusa: {
        x: 0,
        y: 0,
        distance: 780,
        yaw: 22,
        pitch: 62
    },
    sensoji: {
        x: -80,
        y: 320,
        distance: 540,
        yaw: -15,
        pitch: 55
    },
    ueno: {
        x: -1650,
        y: 280,
        distance: 820,
        yaw: 85,
        pitch: 48
    },
    okachimachi: {
        x: -1400,
        y: -450,
        distance: 720,
        yaw: 35,
        pitch: 52
    }
};
for (const b of document.querySelectorAll('[data-place]')){
    b.addEventListener('click', ()=>{
        const p = PLACES[b.dataset.place ?? ''];
        if (p) {
            Object.assign(camera, p);
            schedule();
        }
    });
}
const radiusButtons = document.querySelectorAll('#radius-row button');
for (const b of radiusButtons){
    b.addEventListener('click', ()=>{
        const r = Number(b.dataset.radius);
        if (r && r !== tileRadius) {
            tileRadius = r;
            for (const btn of radiusButtons)btn.classList.toggle('active', btn === b);
            schedule();
        }
    });
}
const sizeInput = document.getElementById('size');
sizeInput.addEventListener('input', ()=>{
    camera.size = Number(sizeInput.value);
    schedule();
});
let drag = null;
canvas.addEventListener('pointerdown', (event)=>{
    drag = {
        x: event.clientX,
        y: event.clientY,
        right: event.button === 2 || event.shiftKey
    };
    canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event)=>{
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.right) {
        const yaw = camera.yaw * Math.PI / 180, factor = camera.distance * 0.0012;
        camera.x -= (Math.cos(yaw) * dx - Math.sin(yaw) * dy) * factor;
        camera.y += (Math.sin(yaw) * dx + Math.cos(yaw) * dy) * factor;
    } else {
        camera.yaw = (camera.yaw + dx * 0.3) % 360;
        camera.pitch = Math.max(10, Math.min(88, camera.pitch + dy * 0.3));
    }
    schedule();
});
canvas.addEventListener('pointerup', ()=>{
    drag = null;
});
canvas.addEventListener('pointercancel', ()=>{
    drag = null;
});
canvas.addEventListener('contextmenu', (event)=>event.preventDefault());
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    camera.distance = Math.max(65, Math.min(25000, camera.distance * Math.exp(event.deltaY * 0.0015)));
    schedule();
}, {
    passive: false
});
if (isBench) {
    void import('./bench.js').then(({ run })=>run({
            device: renderer.device,
            gpu: renderer.gpu,
            draw: renderer.draw,
            readScreen: renderer.readScreen,
            camera,
            origin,
            size: renderer.size,
            ready: ()=>visibleTiles.length > 0 && visibleTiles.every((t)=>t.mesh || t.failed),
            freeze: ()=>{
                frozen = true;
            },
            idle: ()=>pending === 0,
            visible: ()=>visibleTiles.map(({ z, x, y, mesh, failed })=>({
                        z,
                        x,
                        y,
                        mesh,
                        failed
                    })),
            error: ()=>lastError
        }));
}
new ResizeObserver(schedule).observe(canvas);
schedule();
