import { openArchive, rangeStats } from './pmtiles.js';
import { decodeMvt } from './mvt.js';
import { paintTile } from './style.js';
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const ctx = canvas.getContext('2d', {
    alpha: false
});
const SIZE = 512;
const places = {
    tokyo: {
        lon: 139.7671,
        lat: 35.6812,
        zoom: 12
    },
    kyoto: {
        lon: 135.7681,
        lat: 35.0116,
        zoom: 12
    },
    london: {
        lon: -0.1276,
        lat: 51.5072,
        zoom: 11
    },
    newyork: {
        lon: -73.9857,
        lat: 40.7484,
        zoom: 11
    },
    world: {
        lon: 0,
        lat: 25,
        zoom: 2
    }
};
let zoom = places.tokyo.zoom;
const world = ()=>SIZE * 2 ** zoom;
const mercator = (lon, lat)=>({
        x: (lon + 180) / 360 * world(),
        y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * world()
    });
let center = mercator(places.tokyo.lon, places.tokyo.lat);
let archive;
const images = new Map();
const empty = new Set();
const pending = new Set();
const failures = new Map();
let error = '';
let scheduled = false;
const schedule = ()=>{
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{
        scheduled = false;
        draw();
    });
};
function clampCenter() {
    const w = world();
    center.x = Math.max(0, Math.min(w, center.x));
    center.y = Math.max(0, Math.min(w, center.y));
}
function requestTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (images.has(key) || empty.has(key) || pending.has(key) || pending.size >= 8 || Date.now() < (failures.get(key)?.until ?? 0)) return;
    pending.add(key);
    archive.tile(z, x, y).then((bytes)=>bytes ? paintTile(decodeMvt(bytes), z) : null).then((image)=>{
        if (!image) {
            empty.add(key);
            return;
        }
        failures.delete(key);
        error = '';
        images.set(key, image);
        if (images.size > 64) {
            const oldest = images.keys().next().value;
            images.get(oldest).close();
            images.delete(oldest);
        }
    }).catch((reason)=>{
        error = String(reason);
        const count = (failures.get(key)?.count ?? 0) + 1;
        const delay = Math.min(30000, 1000 * 2 ** count);
        failures.set(key, {
            count,
            until: Date.now() + delay
        });
        setTimeout(schedule, delay);
    }).finally(()=>{
        pending.delete(key);
        schedule();
    });
}
function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio;
    const width = rect.width, height = rect.height;
    const pw = Math.round(width * dpr), ph = Math.round(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
    }
    ctx.fillStyle = '#f2f0e9';
    ctx.fillRect(0, 0, pw, ph);
    if (!archive) return;
    const left = center.x - width / 2, top = center.y - height / 2;
    const max = 2 ** zoom;
    const x0 = Math.max(0, Math.floor(left / SIZE));
    const y0 = Math.max(0, Math.floor(top / SIZE));
    const x1 = Math.min(max - 1, Math.floor((left + width) / SIZE));
    const y1 = Math.min(max - 1, Math.floor((top + height) / SIZE));
    let shown = 0;
    for(let y = y0; y <= y1; y++)for(let x = x0; x <= x1; x++){
        const key = `${zoom}/${x}/${y}`;
        const image = images.get(key);
        if (image) {
            const px0 = Math.round((x * SIZE - left) * dpr);
            const py0 = Math.round((y * SIZE - top) * dpr);
            const px1 = Math.round(((x + 1) * SIZE - left) * dpr);
            const py1 = Math.round(((y + 1) * SIZE - top) * dpr);
            ctx.drawImage(image, px0, py0, px1 - px0, py1 - py0);
            shown++;
        } else if (!empty.has(key)) requestTile(zoom, x, y);
    }
    const lon = center.x / world() * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * center.y / world()))) * 180 / Math.PI;
    status.textContent = `z${zoom} · ${lat.toFixed(4)}°, ${lon.toFixed(4)}° · 表示 ${shown} 枚 / 読込中 ${pending.size} 枚 · Range ${rangeStats.requests} 回 / ${(rangeStats.bytes / 1048576).toFixed(1)} MiB${rangeStats.retried200 ? ` · HTTP 200 再試行 ${rangeStats.retried200} 回` : ''}${error ? ` · ${error}` : ''}`;
}
function zoomAt(next, px, py) {
    if (!archive) return;
    next = Math.max(archive.minZoom, Math.min(archive.maxZoom, next));
    if (next === zoom) return;
    const rect = canvas.getBoundingClientRect();
    const factor = 2 ** (next - zoom);
    center.x = (center.x + px - rect.width / 2) * factor - px + rect.width / 2;
    center.y = (center.y + py - rect.height / 2) * factor - py + rect.height / 2;
    zoom = next;
    clampCenter();
    schedule();
}
let last = null;
canvas.addEventListener('pointerdown', (event)=>{
    canvas.setPointerCapture(event.pointerId);
    last = {
        x: event.clientX,
        y: event.clientY
    };
});
canvas.addEventListener('pointermove', (event)=>{
    if (!last) return;
    center.x -= event.clientX - last.x;
    center.y -= event.clientY - last.y;
    last = {
        x: event.clientX,
        y: event.clientY
    };
    clampCenter();
    schedule();
});
const stopDrag = ()=>{
    last = null;
};
canvas.addEventListener('pointerup', stopDrag);
canvas.addEventListener('pointercancel', stopDrag);
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(zoom + (event.deltaY < 0 ? 1 : -1), event.clientX - rect.left, event.clientY - rect.top);
}, {
    passive: false
});
document.getElementById('in').addEventListener('click', ()=>zoomAt(zoom + 1, canvas.clientWidth / 2, canvas.clientHeight / 2));
document.getElementById('out').addEventListener('click', ()=>zoomAt(zoom - 1, canvas.clientWidth / 2, canvas.clientHeight / 2));
for (const button of document.querySelectorAll('[data-place]')){
    button.addEventListener('click', ()=>{
        const place = places[button.dataset.place];
        zoom = place.zoom;
        center = mercator(place.lon, place.lat);
        schedule();
    });
}
new ResizeObserver(schedule).observe(canvas);
try {
    archive = await openArchive();
    schedule();
} catch (reason) {
    status.textContent = `OSM データを開けません: ${String(reason)}`;
}
