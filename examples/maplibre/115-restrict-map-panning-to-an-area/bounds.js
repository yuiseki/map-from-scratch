const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;
const BOUNDS = {
    west: -74.04728500751165,
    east: -73.91058699000139,
    south: 40.68392799015035,
    north: 40.87764500765852
};
const CENTER_LNG = -73.9978;
const CENTER_LAT = 40.7209;
const DEFAULT_ZOOM = 13;
const MAX_ZOOM = 20;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const latFromMercY = (y)=>Math.atan(Math.exp((1 - 2 * y) * Math.PI)) * 360 / Math.PI - 90;
const westMx = mercX(BOUNDS.west);
const eastMx = mercX(BOUNDS.east);
const northMy = mercY(BOUNDS.north);
const southMy = mercY(BOUNDS.south);
const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);
const clamp = (v, lo, hi)=>Math.max(lo, Math.min(hi, v));
export async function mount(canvas, landUrl) {
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
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land: ${res.status}`);
    const polygons = await res.json();
    let centerMx = defaultCenterMx;
    let centerMy = defaultCenterMy;
    let zoom = DEFAULT_ZOOM;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    function minZoomForViewport() {
        const needX = width / (256 * (eastMx - westMx));
        const needY = height / (256 * (southMy - northMy));
        return Math.log2(Math.max(needX, needY));
    }
    function constrain() {
        const scale = 256 * Math.pow(2, zoom);
        const hw = width / (2 * scale);
        const hh = height / (2 * scale);
        const spanX = eastMx - westMx;
        const spanY = southMy - northMy;
        if (spanX <= 2 * hw) centerMx = (westMx + eastMx) / 2;
        else centerMx = clamp(centerMx, westMx + hw, eastMx - hw);
        if (spanY <= 2 * hh) centerMy = (northMy + southMy) / 2;
        else centerMy = clamp(centerMy, northMy + hh, southMy - hh);
    }
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        zoom = Math.max(minZoomForViewport(), Math.min(MAX_ZOOM, zoom));
        constrain();
        draw();
    }
    function getScreenPos(lon, lat) {
        const mx = mercX(lon);
        const my = mercY(lat);
        const scale = 256 * Math.pow(2, zoom);
        return [
            width / 2 + (mx - centerMx) * scale,
            height / 2 + (my - centerMy) * scale
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
                    const r = await fetch(url);
                    if (!r.ok) throw new Error(String(r.status));
                    entry.bitmap = await createImageBitmap(await r.blob());
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
            const r = await fetch(TILE_STYLE);
            if (!r.ok) return;
            tileJson = await r.json();
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
    function draw() {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#b8d6e8';
        ctx.fillRect(0, 0, width, height);
        const scale = 256 * Math.pow(2, zoom);
        const originX = width / 2 - centerMx * scale;
        const originY = height / 2 - centerMy * scale;
        ctx.fillStyle = '#f2efe9';
        ctx.strokeStyle = '#dad7d0';
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
                ctx.stroke();
            }
        }
        const L = baseLayout();
        if (L) {
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
            for(let x = L.x0; x <= L.x1; x++){
                for(let y = L.y0; y <= L.y1; y++)requestTile(L.zi, wrapX(x, L.n), y);
            }
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
        if (!dragging) return;
        dragging = false;
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch  {}
    }
    function onWheel(e) {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        zoomAtPoint(e.clientX - r.left, e.clientY - r.top, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
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
        constrain();
        draw();
    }
    function panBy(dx, dy) {
        const scale = 256 * Math.pow(2, zoom);
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        constrain();
        draw();
    }
    function setZoom(z) {
        zoom = Math.max(minZoomForViewport(), Math.min(MAX_ZOOM, z));
        constrain();
        draw();
    }
    function resetView() {
        centerMx = defaultCenterMx;
        centerMy = defaultCenterMy;
        zoom = Math.max(DEFAULT_ZOOM, minZoomForViewport());
        constrain();
        draw();
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, {
        passive: false
    });
    window.addEventListener('resize', resize);
    void loadBase();
    resize();
    return {
        canvas,
        ctx,
        get center () {
            return [
                centerMx * 360 - 180,
                latFromMercY(centerMy)
            ];
        },
        get centerMercator () {
            return [
                centerMx,
                centerMy
            ];
        },
        get zoom () {
            return zoom;
        },
        get minZoom () {
            return minZoomForViewport();
        },
        bounds: BOUNDS,
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        resetView,
        getScreenPos,
        baseReady: readyTiles,
        baseVisible () {
            const L = baseLayout();
            return L ? (L.x1 - L.x0 + 1) * (L.y1 - L.y0 + 1) : 0;
        },
        baseLoaded () {
            return tileJson !== null;
        },
        destroy () {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', resize);
        }
    };
}
