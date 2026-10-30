import { openArchive, rangeStats, tileStats } from './pmtiles.js';
import { createGlobe } from './gl.js';
const R = 6371000;
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const zoomLabel = document.getElementById('zoom');
const pitchLabel = document.getElementById('pitch');
const exaggeration = document.getElementById('exaggeration');
const exaggerationLabel = document.getElementById('exaggeration-value');
const globe = createGlobe(canvas);
let archive = null;
let lon = 138.7, lat = 35.36, zoom = 0, pitch = 0, exag = 8;
let error = '', scheduled = false;
const cache = new Map();
const used = new Map();
const pending = new Set();
const failures = new Map();
const queued = new Set();
let queue = [];
const key = ({ z, x, y })=>`${z}/${x}/${y}`;
const parent = (tile, z)=>({
        z,
        x: tile.x >> tile.z - z,
        y: tile.y >> tile.z - z
    });
const altitude = ()=>2 * R / 2 ** zoom;
const radians = Math.PI / 180;
const globeVector = (longitude, latitude)=>{
    const a = longitude * radians, b = latitude * radians;
    return [
        Math.cos(b) * Math.cos(a),
        Math.cos(b) * Math.sin(a),
        Math.sin(b)
    ];
};
const tileLatitude = (y, z)=>(2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y / 2 ** z))) - Math.PI / 2) / radians;
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function visible(tile, limit) {
    if (tile.z < 3) return true;
    const n = 2 ** tile.z;
    const longitude = (tile.x + 0.5) / n * 360 - 180;
    const latitude = tileLatitude(tile.y + 0.5, tile.z);
    const center = globeVector(longitude, latitude);
    const focus = globeVector(lon, lat);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(center, focus))));
    let radius = 0;
    for (const dx of [
        0,
        1
    ])for (const dy of [
        0,
        1
    ]){
        const corner = globeVector((tile.x + dx) / n * 360 - 180, tileLatitude(tile.y + dy, tile.z));
        radius = Math.max(radius, Math.acos(Math.max(-1, Math.min(1, dot(center, corner)))));
    }
    return angle < limit + radius;
}
function selectTiles() {
    const alt = altitude();
    const groundPixel = alt * 2 * Math.tan(Math.PI / 8) / Math.max(1, canvas.clientHeight) / Math.cos(pitch * radians);
    let target = Math.max(0, Math.min(archive?.maxZoomAt(lon, lat) ?? 12, Math.ceil(Math.log2(2 * Math.PI * R / (512 * groundPixel)))));
    const aspect = Math.max(1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const p = pitch * radians;
    const span = Math.atan(alt / R * Math.tan(Math.PI / 8) * aspect * 1.7 / Math.cos(p) ** 2);
    const shift = Math.atan(alt / R * Math.tan(p));
    const horizon = Math.acos(R / (R + alt));
    const limit = Math.min(Math.PI, Math.max(span + shift, horizon * (zoom < 2 ? 1.1 : 0.35)));
    const collect = (zTarget)=>{
        let frontier = [
            {
                z: 0,
                x: 0,
                y: 0
            }
        ];
        for(let z = 0; z < zTarget; z++){
            const next = [];
            for (const tile of frontier)for(let dy = 0; dy < 2; dy++)for(let dx = 0; dx < 2; dx++){
                const child = {
                    z: z + 1,
                    x: tile.x * 2 + dx,
                    y: tile.y * 2 + dy
                };
                if (visible(child, limit)) next.push(child);
            }
            frontier = next;
            if (frontier.length > 2000) break;
        }
        return frontier;
    };
    let tiles = collect(target);
    while(tiles.length > 72 && target > 0)tiles = collect(--target);
    return {
        target,
        tiles
    };
}
const decodeCanvas = document.createElement('canvas');
decodeCanvas.width = decodeCanvas.height = 512;
const decodeContext = decodeCanvas.getContext('2d', {
    willReadFrequently: true
});
async function makeTexture(bytes) {
    const bitmap = await createImageBitmap(new Blob([
        Uint8Array.from(bytes)
    ], {
        type: 'image/webp'
    }), {
        colorSpaceConversion: 'none'
    });
    if (bitmap.width !== 512 || bitmap.height !== 512) {
        bitmap.close();
        throw new Error('想定外の標高タイル寸法です');
    }
    decodeContext.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba = decodeContext.getImageData(0, 0, 512, 512).data;
    return {
        texture: globe.texture(rgba),
        rgba
    };
}
function focusHeight() {
    const x = (lon + 180) / 360;
    const y = (1 - Math.asinh(Math.tan(lat * radians)) / Math.PI) / 2;
    for(let z = 18; z >= 0; z--){
        const scale = 2 ** z, tx = Math.floor(x * scale), ty = Math.floor(y * scale);
        const image = cache.get(`${z}/${tx}/${ty}`);
        if (!image) continue;
        const px = Math.min(511, Math.floor((x * scale - tx) * 512));
        const py = Math.min(511, Math.floor((y * scale - ty) * 512));
        const i = (py * 512 + px) * 4;
        const rgb = image.rgba;
        return Math.max(0, rgb[i] * 256 + rgb[i + 1] + rgb[i + 2] / 256 - 32768) * exag;
    }
    return 0;
}
function enqueue(tile) {
    const id = key(tile);
    if (cache.has(id) || pending.has(id) || queued.has(id) || (failures.get(id) ?? 0) >= 2) return;
    queued.add(id);
    queue.push(tile);
}
function pump() {
    if (!archive) return;
    queue.sort((a, b)=>a.z - b.z);
    while(pending.size < 6 && queue.length){
        const tile = queue.shift();
        const id = key(tile);
        queued.delete(id);
        if (cache.has(id) || pending.has(id)) continue;
        pending.add(id);
        archive.tile(tile.z, tile.x, tile.y).then((bytes)=>bytes ? makeTexture(bytes) : null).then((texture)=>{
            cache.set(id, texture);
            used.set(id, performance.now());
            if (cache.size > 88) {
                const victims = [
                    ...used.entries()
                ].filter(([name])=>name !== '0/0/0' && !pending.has(name)).sort((a, b)=>a[1] - b[1]);
                for (const [name] of victims.slice(0, Math.max(0, cache.size - 80))){
                    const old = cache.get(name);
                    if (old) globe.remove(old.texture);
                    cache.delete(name);
                    used.delete(name);
                }
            }
        }).catch((reason)=>{
            error = String(reason);
            failures.set(id, (failures.get(id) ?? 0) + 1);
        }).finally(()=>{
            pending.delete(id);
            schedule();
        });
    }
}
function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(()=>{
        scheduled = false;
        draw();
    });
}
function draw() {
    const { target, tiles } = selectTiles();
    queue = [];
    queued.clear();
    if (archive) enqueue({
        z: 0,
        x: 0,
        y: 0
    });
    const patches = [];
    for (const tile of tiles){
        if (archive) {
            if (target >= 13) enqueue(parent(tile, 8));
            else {
                if (target >= 5) enqueue(parent(tile, 5));
                if (target >= 9) enqueue(parent(tile, 9));
            }
            enqueue(tile);
        }
        let source = null, texture = null;
        for(let z = tile.z; z >= 0; z--){
            const ancestor = parent(tile, z);
            const found = cache.get(key(ancestor));
            if (found) {
                source = ancestor;
                texture = found.texture;
                used.set(key(ancestor), performance.now());
                break;
            }
        }
        if (source) patches.push({
            ...tile,
            sourceZ: source.z,
            sourceX: source.x,
            sourceY: source.y,
            texture
        });
    }
    pump();
    globe.draw({
        lon,
        lat,
        altitude: altitude(),
        focusHeight: focusHeight(),
        pitch,
        exaggeration: exag,
        width: canvas.clientWidth,
        height: canvas.clientHeight
    }, patches);
    zoomLabel.textContent = `標高 z${target} · ${Math.round(altitude() / 1000).toLocaleString('ja-JP')} km 上空`;
    pitchLabel.textContent = `傾き ${Math.round(pitch)}°`;
    status.textContent = error || `${tiles.length} 区画 · 読込済 ${cache.size} · 読込中 ${pending.size} · CDN ${tileStats.requests} 枚 / ${(tileStats.bytes / 1048576).toFixed(1)} MiB · PMTiles Range ${rangeStats.requests} 回 / ${(rangeStats.bytes / 1048576).toFixed(1)} MiB`;
}
function setView(place) {
    lon = place.lon;
    lat = place.lat;
    zoom = place.zoom;
    pitch = place.pitch;
    exag = place.exag;
    exaggeration.value = String(exag);
    exaggerationLabel.textContent = `${exag}×`;
    error = '';
    schedule();
}
const places = {
    earth: {
        lon: 138.7,
        lat: 35.36,
        zoom: 0,
        pitch: 0,
        exag: 8
    },
    fuji: {
        lon: 138.7274,
        lat: 35.3606,
        zoom: 9.5,
        pitch: 58,
        exag: 2
    },
    alps: {
        lon: 8.0587,
        lat: 46.4768,
        zoom: 9,
        pitch: 60,
        exag: 2
    },
    himalaya: {
        lon: 86.925,
        lat: 27.988,
        zoom: 9,
        pitch: 58,
        exag: 2
    },
    canyon: {
        lon: -112.14,
        lat: 36.05,
        zoom: 9.5,
        pitch: 58,
        exag: 3
    }
};
document.querySelectorAll('[data-place]').forEach((button)=>{
    button.addEventListener('click', ()=>setView(places[button.dataset.place]));
});
function changeZoom(delta) {
    const previous = zoom;
    zoom = Math.max(0, Math.min(16, zoom + delta));
    if (previous < 4 && zoom >= 4 && pitch === 0) pitch = 55;
    if (zoom < 2) pitch = Math.min(pitch, 30);
    schedule();
}
document.getElementById('plus').addEventListener('click', ()=>changeZoom(1));
document.getElementById('minus').addEventListener('click', ()=>changeZoom(-1));
exaggeration.addEventListener('input', ()=>{
    exag = Number(exaggeration.value);
    exaggerationLabel.textContent = `${exag}×`;
    schedule();
});
canvas.addEventListener('wheel', (event)=>{
    event.preventDefault();
    changeZoom(-event.deltaY * 0.0025);
}, {
    passive: false
});
canvas.addEventListener('contextmenu', (event)=>event.preventDefault());
let drag = null;
canvas.addEventListener('pointerdown', (event)=>{
    canvas.setPointerCapture(event.pointerId);
    drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        right: event.button === 2 || event.shiftKey
    };
});
canvas.addEventListener('pointermove', (event)=>{
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.right) pitch = Math.max(0, Math.min(72, pitch + dy * 0.3));
    else {
        const radPerPixel = altitude() * 2 * Math.tan(Math.PI / 8) / (R * Math.max(1, canvas.clientHeight));
        lon = (lon - dx * radPerPixel / (radians * Math.max(0.1, Math.cos(lat * radians))) + 540) % 360 - 180;
        lat = Math.max(-80, Math.min(80, lat + dy * radPerPixel / radians));
    }
    schedule();
});
canvas.addEventListener('pointerup', ()=>{
    drag = null;
});
canvas.addEventListener('pointercancel', ()=>{
    drag = null;
});
new ResizeObserver(schedule).observe(canvas);
schedule();
try {
    archive = await openArchive();
    archive.ready.then(schedule).catch((reason)=>{
        error = String(reason);
        schedule();
    });
    schedule();
} catch (reason) {
    error = String(reason);
    schedule();
}
