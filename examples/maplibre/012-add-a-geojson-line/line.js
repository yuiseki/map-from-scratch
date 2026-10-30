const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;
const SF_LNG = -122.486052;
const SF_LAT = 37.830348;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const defaultCenterMx = mercX(SF_LNG);
const defaultCenterMy = mercY(SF_LAT);
export async function mount(canvas, routeUrl, landUrl) {
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
    let lineVisible = true;
    const [routeRes, landRes] = await Promise.all([
        fetch(routeUrl),
        fetch(landUrl)
    ]);
    if (!routeRes.ok) throw new Error(`failed to fetch route: ${routeRes.status}`);
    if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);
    const route = await routeRes.json();
    const polygons = await landRes.json();
    let centerMx = defaultCenterMx;
    let centerMy = defaultCenterMy;
    let zoom = 15;
    let lineColor = '#888888';
    let lineWidth = 8;
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
        const mx = mercX(lon);
        const my = mercY(lat);
        const scale = 256 * Math.pow(2, zoom);
        const sx = width / 2 + (mx - centerMx) * scale;
        const sy = height / 2 + (my - centerMy) * scale;
        return [
            sx,
            sy
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
        if (lineVisible && route.length > 1) {
            ctx.beginPath();
            for(let i = 0; i < route.length; i++){
                const sx = originX + route[i][0] * scale;
                const sy = originY + route[i][1] * scale;
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }
    let dragging = false;
    let startX = 0;
    let startY = 0;
    function onPointerDown(e) {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
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
        const dz = e.deltaY < 0 ? 0.25 : -0.25;
        zoomAt(e, zoom + dz);
    }
    function zoomAt(e, z) {
        const r = canvas.getBoundingClientRect();
        const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
        const before = 256 * Math.pow(2, zoom);
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
        zoom = Math.max(1, Math.min(20, z));
        draw();
    }
    function setLineStyle(color, width) {
        lineColor = color;
        lineWidth = width;
        draw();
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
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
                centerMx,
                centerMy
            ];
        },
        get zoom () {
            return zoom;
        },
        get lineColor () {
            return lineColor;
        },
        get lineWidth () {
            return lineWidth;
        },
        draw,
        panBy,
        setZoom,
        setLineStyle,
        setBaseVisible (v) {
            baseVisible = v;
            draw();
        },
        setLineVisible (v) {
            lineVisible = v;
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
            zoom = 15;
            draw();
        },
        getScreenPos,
        destroy () {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', resize);
        }
    };
}
