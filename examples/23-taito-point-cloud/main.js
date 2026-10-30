import { decodePcpng } from './decode.js';
import { createRenderer } from './render.js';
import { fallbackTiles, planTiles } from './tiles.js';
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
const renderer = createRenderer(canvas);
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
    if (scheduled) return;
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
    const plan = planTiles(z, mx0 + camera.x / world, my0 - camera.y / world, zoomIn);
    previousDistance = camera.distance;
    const wanted = plan.visible.map(({ z, x, y })=>tile(z, x, y));
    const prefetch = plan.prefetch.map(({ z, x, y })=>tile(z, x, y));
    const now = performance.now();
    for (const t of [
        ...wanted,
        ...prefetch
    ])t.used = now;
    for (const t of wanted){
        if (pending >= 5) break;
        if (!t.mesh && !t.loading && !t.failed) void load(t, false);
    }
    if (wanted.every((t)=>t.mesh || t.failed)) {
        for (const t of prefetch){
            if (pending >= 5 || prefetchPending >= 2) break;
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
    if (gpuBytes > 120 * 1048576) {
        for (const t of [
            ...tiles.values()
        ].filter((t)=>t.mesh && t.used !== now).sort((a, b)=>a.used - b.used)){
            if (gpuBytes < 85 * 1048576) break;
            gpuBytes -= t.mesh.bytes;
            points -= t.mesh.count;
            renderer.remove(t.mesh);
            t.mesh = null;
        }
    }
    detail.textContent = `z${z} · 視点距離 ${Math.round(camera.distance)} m · 点サイズ ${camera.size.toFixed(1)}`;
    const prefetched = prefetch.filter((t)=>t.mesh || t.failed).length;
    status.textContent = `${shown.length} タイル表示${fallback.length ? ` ＋ ${fallback.length} 補完` : ''} · 前後のズームを先読み ${prefetched}/${prefetch.length} · 読込中 ${pending} · ${points.toLocaleString()} 点取得 · ${(bytes / 1048576).toFixed(1)} MiB / ${requests} 件${lastError ? ` · ${lastError}` : ''}`;
}
const places = {
    asakusa: [
        139.795922,
        35.711917,
        780
    ],
    sensoji: [
        139.79665,
        35.71478,
        700
    ],
    ueno: [
        139.7749,
        35.7144,
        800
    ],
    okachimachi: [
        139.7748,
        35.7075,
        650
    ]
};
function setPlace(name) {
    const place = places[name];
    if (!place) return;
    const [mx, my] = mercator(place[0], place[1]);
    camera.x = (mx - mx0) * world;
    camera.y = (my0 - my) * world;
    camera.distance = place[2];
    schedule();
}
document.querySelectorAll('[data-place]').forEach((button)=>button.addEventListener('click', ()=>{
        setPlace(button.dataset.place);
        history.replaceState(null, '', `?place=${button.dataset.place}`);
    }));
setPlace(new URLSearchParams(location.search).get('place') ?? 'asakusa');
document.getElementById('size').addEventListener('input', (event)=>{
    camera.size = Number(event.target.value);
    schedule();
});
canvas.addEventListener('contextmenu', (event)=>event.preventDefault());
let drag = null;
canvas.addEventListener('pointerdown', (event)=>{
    canvas.setPointerCapture(event.pointerId);
    drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pan: event.button === 2 || event.shiftKey
    };
});
canvas.addEventListener('pointermove', (event)=>{
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.pan) {
        const units = camera.distance * 2 * Math.tan(Math.PI / 6) / Math.max(1, canvas.clientHeight);
        const yaw = camera.yaw * Math.PI / 180;
        camera.x -= (Math.cos(yaw) * dx + Math.sin(yaw) * dy) * units;
        camera.y -= (Math.sin(yaw) * dx - Math.cos(yaw) * dy) * units;
    } else {
        camera.yaw = (camera.yaw - dx * 0.3 + 360) % 360;
        camera.pitch = Math.max(20, Math.min(85, camera.pitch + dy * 0.25));
    }
    schedule();
});
canvas.addEventListener('pointerup', ()=>{
    drag = null;
});
canvas.addEventListener('pointercancel', ()=>{
    drag = null;
});
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    camera.distance = Math.max(65, Math.min(9000, camera.distance * Math.exp(event.deltaY * 0.0015)));
    schedule();
}, {
    passive: false
});
new ResizeObserver(schedule).observe(canvas);
schedule();
