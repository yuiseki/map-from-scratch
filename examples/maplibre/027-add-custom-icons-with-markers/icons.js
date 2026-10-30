const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;
const MARKERS = [
    {
        lng: -73.98,
        lat: 40.75,
        color: '#1b8a3a',
        name: 'green'
    },
    {
        lng: -73.88,
        lat: 40.81,
        color: '#e8590c',
        name: 'orange'
    },
    {
        lng: -74.08,
        lat: 40.69,
        color: '#b3125c',
        name: 'magenta'
    }
];
const PIN_W = 36;
const PIN_H = 48;
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const targets = MARKERS.map((m)=>({
        mx: mercX(m.lng),
        my: mercY(m.lat)
    }));
function makePinSprite(color, scale) {
    const c = document.createElement('canvas');
    c.width = Math.round(PIN_W * scale);
    c.height = Math.round(PIN_H * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = color;
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(10, 24);
    g.lineTo(18, 46);
    g.lineTo(26, 24);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(18, 16, 12, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(18, 16, 4.5, 0, Math.PI * 2);
    g.fill();
    return c;
}
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!ctx) throw new Error('2D context not available');
    let tileJson = null;
    const tiles = new Map();
    const queued = new Set();
    const queue = [];
    let inFlight = 0;
    let rafId = 0;
    let baseVisible = true;
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
    const polygons = await res.json();
    let centerMx = targets[0].mx;
    let centerMy = targets[0].my;
    let zoom = 10;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    let sprites = MARKERS.map((m)=>makePinSprite(m.color, dpr));
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        sprites = MARKERS.map((m)=>makePinSprite(m.color, dpr));
        draw();
    }
    function getMarkerScreenPos(index) {
        const scale = 256 * Math.pow(2, zoom);
        return [
            width / 2 + (targets[index].mx - centerMx) * scale,
            height / 2 + (targets[index].my - centerMy) * scale
        ];
    }
    function baseLayout() {
        if (!tileJson) return null;
        const zi = Math.max(tileJson.minzoom, Math.min(tileJson.maxzoom, Math.round(zoom + Math.log2(devicePixelRatio || 1) - 1)));
        const n = 1 << zi;
        const tile = 256 * Math.pow(2, zoom - zi);
        const scale = 256 * Math.pow(2, zoom);
        const originX = width / 2 - centerMx * scale;
        const originY = height / 2 - centerMy * scale;
        return {
            zi,
            n,
            tile,
            originX,
            originY,
            x0: Math.floor(-originX / tile),
            x1: Math.floor((width - originX) / tile),
            y0: Math.max(0, Math.floor(-originY / tile)),
            y1: Math.min(n - 1, Math.floor((height - originY) / tile))
        };
    }
    const wrapX = (x, n)=>(x % n + n) % n;
    const tileKey = (z, x, y)=>`${z}/${x}/${y}`;
    function requestTile(zi, wx, y) {
        const key = tileKey(zi, wx, y);
        if (tiles.has(key) || queued.has(key)) return;
        queued.add(key);
        queue.push(key);
        pump();
    }
    function pump() {
        while(inFlight < MAX_IN_FLIGHT && queue.length > 0){
            const key = queue.shift();
            queued.delete(key);
            const [z, x, y] = key.split('/');
            const url = tileJson.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
            const entry = {
                state: 'loading'
            };
            tiles.set(key, entry);
            inFlight++;
            void (async ()=>{
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(String(res.status));
                    entry.bitmap = await createImageBitmap(await res.blob());
                    entry.state = 'ready';
                } catch  {
                    entry.state = 'error';
                } finally{
                    inFlight--;
                    pump();
                    scheduleDraw();
                }
            })();
        }
    }
    function scheduleDraw() {
        if (rafId) return;
        rafId = requestAnimationFrame(()=>{
            rafId = 0;
            draw();
        });
    }
    async function loadBase() {
        try {
            const res = await fetch(TILE_STYLE);
            if (!res.ok) return;
            tileJson = await res.json();
            scheduleDraw();
        } catch  {}
    }
    function readyTiles() {
        const L = baseLayout();
        if (!L) return 0;
        let ready = 0;
        for(let x = L.x0; x <= L.x1; x++){
            for(let y = L.y0; y <= L.y1; y++){
                if (tiles.get(tileKey(L.zi, wrapX(x, L.n), y))?.state === 'ready') ready++;
            }
        }
        return ready;
    }
    function baseFullyReady(L) {
        if (L.y0 !== Math.floor(-L.originY / L.tile)) return false;
        if (L.y1 !== Math.floor((height - L.originY) / L.tile)) return false;
        for(let x = L.x0; x <= L.x1; x++){
            for(let y = L.y0; y <= L.y1; y++){
                if (tiles.get(tileKey(L.zi, wrapX(x, L.n), y))?.state !== 'ready') return false;
            }
        }
        return true;
    }
    function draw() {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#aad3df';
        ctx.fillRect(0, 0, width, height);
        const scale = 256 * Math.pow(2, zoom);
        const originX = width / 2 - centerMx * scale;
        const originY = height / 2 - centerMy * scale;
        const L = baseLayout();
        const covered = baseVisible && L !== null && baseFullyReady(L);
        if (!covered) {
            ctx.fillStyle = '#f0eee8';
            ctx.strokeStyle = '#d0cdc4';
            ctx.lineWidth = 1;
            const minWrap = Math.floor(centerMx - width / (2 * scale));
            const maxWrap = Math.floor(centerMx + width / (2 * scale));
            for(let wrap = minWrap; wrap <= maxWrap; wrap++){
                const shiftX = originX + wrap * scale;
                for (const poly of polygons){
                    if (poly.length === 0) continue;
                    ctx.beginPath();
                    for (const ring of poly){
                        for(let i = 0; i < ring.length; i++){
                            const rx = shiftX + ring[i][0] * scale;
                            const ry = originY + ring[i][1] * scale;
                            if (i === 0) ctx.moveTo(rx, ry);
                            else ctx.lineTo(rx, ry);
                        }
                    }
                    ctx.fill();
                    ctx.beginPath();
                    for (const ring of poly){
                        for(let i = 1; i < ring.length; i++){
                            const a = ring[i - 1], b = ring[i];
                            if (a[0] <= 0 && b[0] <= 0 || a[0] >= 1 && b[0] >= 1) continue;
                            ctx.moveTo(shiftX + a[0] * scale, originY + a[1] * scale);
                            ctx.lineTo(shiftX + b[0] * scale, originY + b[1] * scale);
                        }
                    }
                    ctx.stroke();
                }
            }
        }
        if (baseVisible && L) {
            for(let x = L.x0; x <= L.x1; x++){
                const X0 = Math.round(L.originX + x * L.tile);
                const X1 = Math.round(L.originX + (x + 1) * L.tile);
                for(let y = L.y0; y <= L.y1; y++){
                    const Y0 = Math.round(L.originY + y * L.tile);
                    const Y1 = Math.round(L.originY + (y + 1) * L.tile);
                    const entry = tiles.get(tileKey(L.zi, wrapX(x, L.n), y));
                    if (entry?.state === 'ready' && entry.bitmap) {
                        ctx.drawImage(entry.bitmap, X0, Y0, X1 - X0, Y1 - Y0);
                    }
                }
            }
        }
        if (L) {
            for(let x = L.x0; x <= L.x1; x++){
                for(let y = L.y0; y <= L.y1; y++)requestTile(L.zi, wrapX(x, L.n), y);
            }
        }
        for(let i = 0; i < MARKERS.length; i++){
            const [sx, sy] = getMarkerScreenPos(i);
            ctx.drawImage(sprites[i], sx - PIN_W / 2, sy - PIN_H, PIN_W, PIN_H);
        }
        ctx.restore();
    }
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    function onPointerDown(e) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        panBy(dx, dy);
    }
    function onPointerUp(e) {
        if (dragging) {
            dragging = false;
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        }
    }
    function zoomAtPoint(x, y, z) {
        const before = 256 * Math.pow(2, zoom);
        const ox = x - width / 2;
        const oy = y - height / 2;
        centerMx += ox / before;
        centerMy += oy / before;
        setZoom(z);
        const after = 256 * Math.pow(2, zoom);
        centerMx -= ox / after;
        centerMy -= oy / after;
        draw();
    }
    function onWheel(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
    }
    function panBy(dx, dy) {
        const scale = 256 * Math.pow(2, zoom);
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        draw();
    }
    function setZoom(z) {
        zoom = Math.max(1, Math.min(18, z));
        draw();
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, {
        passive: false
    });
    const ro = new ResizeObserver(()=>resize());
    ro.observe(canvas);
    resize();
    void loadBase();
    return {
        canvas,
        ctx,
        get center () {
            return [
                centerMx,
                centerMy
            ];
        },
        get zoom () {
            return zoom;
        },
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        getMarkerScreenPos,
        get markerCount () {
            return MARKERS.length;
        },
        setBaseVisible (v) {
            baseVisible = v;
            draw();
        },
        baseReady: readyTiles,
        baseLoaded: ()=>tileJson !== null,
        baseComplete: ()=>{
            const L = baseLayout();
            return L !== null && baseFullyReady(L);
        },
        resetView () {
            centerMx = targets[0].mx;
            centerMy = targets[0].my;
            zoom = 10;
            draw();
        },
        destroy () {
            ro.disconnect();
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
        }
    };
}
