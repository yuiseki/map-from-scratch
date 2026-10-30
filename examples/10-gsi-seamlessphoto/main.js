import { openArchive } from './pmtiles.js';
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
        zoom: 14
    },
    fuji: {
        lon: 138.7274,
        lat: 35.3606,
        zoom: 13
    },
    osaka: {
        lon: 135.5259,
        lat: 34.6873,
        zoom: 14
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
const pending = new Set();
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
    if (images.has(key) || pending.has(key) || pending.size >= 16) return;
    pending.add(key);
    archive.tile(z, x, y).then((bytes)=>bytes ? createImageBitmap(new Blob([
            Uint8Array.from(bytes)
        ], {
            type: 'image/jpeg'
        })) : null).then((image)=>{
        images.set(key, image);
        if (images.size > 96) {
            const oldest = images.keys().next().value;
            images.get(oldest)?.close();
            images.delete(oldest);
        }
    }).catch((reason)=>{
        error = String(reason);
        images.set(key, null);
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
    ctx.fillStyle = '#253441';
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
        } else if (!images.has(key)) requestTile(zoom, x, y);
    }
    const lon = center.x / world() * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * center.y / world()))) * 180 / Math.PI;
    status.textContent = error || `z${zoom} · ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E · 表示 ${shown} 枚${pending.size ? ` / 読込中 ${pending.size} 枚` : ''}`;
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
    status.textContent = `写真データを開けません: ${String(reason)}`;
}
