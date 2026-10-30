const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;
const CENTER_LNG = -87.6321;
const CENTER_LAT = 41.8362;
const MIN_ZOOM = 9.5;
const MAX_ZOOM = 13;
const DEFAULT_ZOOM = 9.5;
const OVERLAY = {
    west: -88.4,
    east: -86.85,
    south: 41.45,
    north: 42.15
};
const PANEL = {
    x: 12,
    y: 12,
    width: 250,
    height: 66
};
const TRACK_X0 = 24;
const TRACK_X1 = 238;
const TRACK_Y = 52;
const KNOB_R = 7;
const ACCENT = '#2a7ae2';
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const overlayWestMx = mercX(OVERLAY.west);
const overlayEastMx = mercX(OVERLAY.east);
const overlayNorthMy = mercY(OVERLAY.north);
const overlaySouthMy = mercY(OVERLAY.south);
const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);
export async function mount(canvas, overlayUrl, landUrl) {
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
    const [overlayRes, landRes] = await Promise.all([
        fetch(overlayUrl),
        fetch(landUrl)
    ]);
    if (!overlayRes.ok) throw new Error(`failed to fetch overlay: ${overlayRes.status}`);
    if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);
    const overlay = await createImageBitmap(await overlayRes.blob());
    const polygons = await landRes.json();
    let centerMx = defaultCenterMx;
    let centerMy = defaultCenterMy;
    let zoom = DEFAULT_ZOOM;
    let opacity = 100;
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
    function getOverlayRect() {
        const scale = 256 * Math.pow(2, zoom);
        return {
            x: width / 2 + (overlayWestMx - centerMx) * scale,
            y: height / 2 + (overlayNorthMy - centerMy) * scale,
            width: (overlayEastMx - overlayWestMx) * scale,
            height: (overlaySouthMy - overlayNorthMy) * scale
        };
    }
    function getSliderTrack() {
        return {
            x0: TRACK_X0,
            x1: TRACK_X1,
            y: TRACK_Y
        };
    }
    function getSliderHitRect() {
        return {
            x: TRACK_X0 - 10,
            y: TRACK_Y - 14,
            width: TRACK_X1 - TRACK_X0 + 20,
            height: 28
        };
    }
    function getKnobPos() {
        return [
            TRACK_X0 + (TRACK_X1 - TRACK_X0) * opacity / 100,
            TRACK_Y
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
        const r = getOverlayRect();
        ctx.save();
        ctx.globalAlpha = opacity / 100;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(overlay, r.x, r.y, r.width, r.height);
        ctx.restore();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.beginPath();
        const p = PANEL;
        const rad = 8;
        ctx.moveTo(p.x + rad, p.y);
        ctx.arcTo(p.x + p.width, p.y, p.x + p.width, p.y + p.height, rad);
        ctx.arcTo(p.x + p.width, p.y + p.height, p.x, p.y + p.height, rad);
        ctx.arcTo(p.x, p.y + p.height, p.x, p.y, rad);
        ctx.arcTo(p.x, p.y, p.x + p.width, p.y, rad);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#1f3a52';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`Layer opacity: ${opacity}%`, TRACK_X0, 32);
        const [kx] = getKnobPos();
        ctx.lineCap = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#cfd6e2';
        ctx.beginPath();
        ctx.moveTo(TRACK_X0, TRACK_Y);
        ctx.lineTo(TRACK_X1, TRACK_Y);
        ctx.stroke();
        ctx.strokeStyle = ACCENT;
        ctx.beginPath();
        ctx.moveTo(TRACK_X0, TRACK_Y);
        ctx.lineTo(kx, TRACK_Y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(kx, TRACK_Y, KNOB_R, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
        ctx.restore();
    }
    let mode = 'none';
    let lastX = 0;
    let lastY = 0;
    const local = (e)=>{
        const r = canvas.getBoundingClientRect();
        return [
            e.clientX - r.left,
            e.clientY - r.top
        ];
    };
    const inRect = (x, y, r)=>x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    function setOpacityFromX(x) {
        const v = (x - TRACK_X0) / (TRACK_X1 - TRACK_X0) * 100;
        setOpacity(v);
    }
    function onPointerDown(e) {
        const [x, y] = local(e);
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
        if (inRect(x, y, getSliderHitRect())) {
            mode = 'slider';
            setOpacityFromX(x);
            return;
        }
        mode = 'map';
        lastX = e.clientX;
        lastY = e.clientY;
    }
    function onPointerMove(e) {
        if (mode === 'none') return;
        if (mode === 'slider') {
            setOpacityFromX(local(e)[0]);
            return;
        }
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        panBy(dx, dy);
    }
    function onPointerUp(e) {
        if (mode === 'none') return;
        mode = 'none';
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch  {}
    }
    function onWheel(e) {
        e.preventDefault();
        const [x, y] = local(e);
        zoomAtPoint(x, y, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
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
    function panBy(dx, dy) {
        const scale = 256 * Math.pow(2, zoom);
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        draw();
    }
    function setZoom(z) {
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
        draw();
    }
    function setOpacity(v) {
        opacity = Math.max(0, Math.min(100, Math.round(v)));
        draw();
    }
    function resetView() {
        centerMx = defaultCenterMx;
        centerMy = defaultCenterMy;
        zoom = DEFAULT_ZOOM;
        opacity = 100;
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
                Math.atan(Math.exp((1 - 2 * centerMy) * Math.PI)) * 360 / Math.PI - 90
            ];
        },
        get zoom () {
            return zoom;
        },
        get opacity () {
            return opacity;
        },
        overlayBounds: OVERLAY,
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        resetView,
        setOpacity,
        getPanelRect: ()=>({
                ...PANEL
            }),
        getSliderTrack,
        getSliderHitRect,
        getKnobPos,
        getOverlayRect,
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
