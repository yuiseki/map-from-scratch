const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;
const WEST = -80.425;
const EAST = -71.516;
const NORTH = 46.437;
const SOUTH = 37.936;
const CENTER_LNG = -75.789;
const CENTER_LAT = 41.874;
const DEFAULT_ZOOM = 5;
const OCEAN = '#b8d6e8';
const LAND = '#f2efe9';
const LAND_EDGE = '#dad7d0';
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);
export async function mount(canvas, landUrl, imageUrl) {
    const rawCtx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!rawCtx) throw new Error('2D context not available');
    const ctx = rawCtx;
    let tileJson = null;
    const tiles = new Map();
    const queued = new Set();
    const queue = [];
    let inFlight = 0;
    let rafId = 0;
    let baseVisible = true;
    let overlay = null;
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land: ${res.status}`);
    const polygons = await res.json();
    let centerMx = defaultCenterMx;
    let centerMy = defaultCenterMy;
    let zoom = DEFAULT_ZOOM;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        draw();
    }
    function getScreenPos(lon, lat) {
        const scale = 256 * Math.pow(2, zoom);
        return [
            width / 2 + (mercX(lon) - centerMx) * scale,
            height / 2 + (mercY(lat) - centerMy) * scale
        ];
    }
    function baseLayout() {
        if (!tileJson) return null;
        const zi = Math.max(tileJson.minzoom, Math.min(tileJson.maxzoom, Math.round(zoom + Math.log2(dpr) - 1)));
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
                    const tileRes = await fetch(url);
                    if (!tileRes.ok) throw new Error(String(tileRes.status));
                    entry.bitmap = await createImageBitmap(await tileRes.blob());
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
            const styleRes = await fetch(TILE_STYLE);
            if (!styleRes.ok) return;
            tileJson = await styleRes.json();
            scheduleDraw();
        } catch  {}
    }
    async function loadOverlay() {
        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) throw new Error(`failed to fetch overlay image: ${imageRes.status}`);
        overlay = await createImageBitmap(await imageRes.blob());
        scheduleDraw();
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
    function draw() {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = OCEAN;
        ctx.fillRect(0, 0, width, height);
        const scale = 256 * Math.pow(2, zoom);
        const originX = width / 2 - centerMx * scale;
        const originY = height / 2 - centerMy * scale;
        ctx.fillStyle = LAND;
        ctx.strokeStyle = LAND_EDGE;
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
                        const x = shiftX + ring[i][0] * scale;
                        const y = originY + ring[i][1] * scale;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
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
        const L = baseLayout();
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
        if (overlay) {
            const x0 = width / 2 + (mercX(WEST) - centerMx) * scale;
            const x1 = width / 2 + (mercX(EAST) - centerMx) * scale;
            const y0 = height / 2 + (mercY(NORTH) - centerMy) * scale;
            const y1 = height / 2 + (mercY(SOUTH) - centerMy) * scale;
            ctx.drawImage(overlay, x0, y0, x1 - x0, y1 - y0);
        }
        ctx.restore();
    }
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e)=>{
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        panBy(dx, dy);
    });
    canvas.addEventListener('pointerup', (e)=>{
        dragging = false;
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch  {}
    });
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.25 : -0.25));
    }, {
        passive: false
    });
    window.addEventListener('resize', resize);
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
    resize();
    void loadBase();
    await loadOverlay();
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
        imageLoaded: ()=>overlay !== null,
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        getScreenPos,
        setBaseVisible (v) {
            baseVisible = v;
            draw();
        },
        baseReady: readyTiles,
        baseVisible () {
            const L = baseLayout();
            return L ? (L.x1 - L.x0 + 1) * (L.y1 - L.y0 + 1) : 0;
        },
        baseLoaded () {
            return tileJson !== null;
        },
        resetView () {
            centerMx = defaultCenterMx;
            centerMy = defaultCenterMy;
            zoom = DEFAULT_ZOOM;
            draw();
        },
        destroy () {
            window.removeEventListener('resize', resize);
        }
    };
}
