const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;
const MONUMENT = [
    -77.0353,
    38.8895
];
const DEFAULT_ZOOM = 5;
const OCEAN = '#b8d6e8';
const LAND = '#f2efe9';
const LAND_EDGE = '#dad7d0';
const MARKER_R = 25;
const MARKER_SKY = '#9ec9e8';
const MARKER_STONE = '#efe9dc';
const MARKER_GROUND = '#7aa86b';
const POPUP_OFFSET = 25;
const POPUP_W = 200;
const POPUP_PAD = 10;
const POPUP_LINE = 16;
const POPUP_TIP = 10;
const POPUP_LINES = [
    'Construction on the',
    'Washington Monument',
    'began in 1848.'
];
const POPUP_H = POPUP_PAD * 2 + POPUP_LINE * POPUP_LINES.length;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
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
    let baseVisible = true;
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land: ${res.status}`);
    const polygons = await res.json();
    const defaultCenterMx = mercX(MONUMENT[0]);
    const defaultCenterMy = mercY(MONUMENT[1]);
    let centerMx = defaultCenterMx;
    let centerMy = defaultCenterMy;
    let zoom = DEFAULT_ZOOM;
    let popupVisible = false;
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
    function getPopupBounds() {
        const [mx, my] = getScreenPos(MONUMENT[0], MONUMENT[1]);
        const tipY = my - POPUP_OFFSET;
        const bx = mx - POPUP_W / 2;
        const by = tipY - POPUP_TIP - POPUP_H;
        return {
            x: bx,
            y: by,
            width: POPUP_W,
            height: POPUP_H,
            closeBtn: {
                x: bx + POPUP_W - 20,
                y: by + 6,
                size: 16
            }
        };
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
    function drawMarker(x, y) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, MARKER_R, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = MARKER_SKY;
        ctx.fillRect(x - MARKER_R, y - MARKER_R, MARKER_R * 2, MARKER_R * 2);
        ctx.fillStyle = MARKER_STONE;
        ctx.fillRect(x - 4, y - 14, 8, 32);
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 14);
        ctx.lineTo(x, y - 20);
        ctx.lineTo(x + 4, y - 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = MARKER_GROUND;
        ctx.fillRect(x - MARKER_R, y + 18, MARKER_R * 2, MARKER_R);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, MARKER_R, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    function drawPopup() {
        const b = getPopupBounds();
        const [tipX, tipY] = getScreenPos(MONUMENT[0], MONUMENT[1]);
        const tipYOffset = tipY - POPUP_OFFSET;
        const r = 6;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.moveTo(b.x + r, b.y);
        ctx.lineTo(b.x + b.width - r, b.y);
        ctx.arcTo(b.x + b.width, b.y, b.x + b.width, b.y + r, r);
        ctx.lineTo(b.x + b.width, b.y + b.height - r);
        ctx.arcTo(b.x + b.width, b.y + b.height, b.x + b.width - r, b.y + b.height, r);
        ctx.lineTo(tipX + 8, b.y + b.height);
        ctx.lineTo(tipX, tipYOffset);
        ctx.lineTo(tipX - 8, b.y + b.height);
        ctx.lineTo(b.x + r, b.y + b.height);
        ctx.arcTo(b.x, b.y + b.height, b.x, b.y + b.height - r, r);
        ctx.lineTo(b.x, b.y + r);
        ctx.arcTo(b.x, b.y, b.x + r, b.y, r);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#333333';
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for(let i = 0; i < POPUP_LINES.length; i++){
            ctx.fillText(POPUP_LINES[i], b.x + b.width / 2, b.y + POPUP_PAD + POPUP_LINE / 2 + i * POPUP_LINE);
        }
        ctx.fillStyle = '#888888';
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillText('×', b.closeBtn.x + b.closeBtn.size / 2, b.closeBtn.y + b.closeBtn.size / 2);
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
        const [mx, my] = getScreenPos(MONUMENT[0], MONUMENT[1]);
        drawMarker(mx, my);
        if (popupVisible) drawPopup();
        ctx.restore();
    }
    let dragging = false;
    let didDrag = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    function localPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
    }
    function onPointerDown(e) {
        dragging = true;
        didDrag = false;
        downX = lastX = e.clientX;
        downY = lastY = e.clientY;
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
    }
    function onPointerMove(e) {
        if (!dragging) {
            const [x, y] = localPoint(e);
            const [mx, my] = getScreenPos(MONUMENT[0], MONUMENT[1]);
            const over = Math.hypot(x - mx, y - my) <= MARKER_R;
            canvas.style.cursor = over ? 'pointer' : 'grab';
            return;
        }
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) didDrag = true;
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
        if (didDrag) return;
        const [x, y] = localPoint(e);
        if (popupVisible) {
            const btn = getPopupBounds().closeBtn;
            if (x >= btn.x && x <= btn.x + btn.size && y >= btn.y && y <= btn.y + btn.size) {
                popupVisible = false;
                draw();
                return;
            }
        }
        const [mx, my] = getScreenPos(MONUMENT[0], MONUMENT[1]);
        if (Math.hypot(x - mx, y - my) <= MARKER_R) {
            popupVisible = !popupVisible;
            draw();
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
        zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.25 : -0.25));
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
    canvas.addEventListener('wheel', onWheel, {
        passive: false
    });
    window.addEventListener('resize', resize);
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
        get popupVisible () {
            return popupVisible;
        },
        markerLngLat: MONUMENT,
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        getScreenPos,
        getPopupBounds,
        getPopupAnchor: ()=>MONUMENT,
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
            popupVisible = false;
            draw();
        },
        destroy () {
            window.removeEventListener('resize', resize);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
        }
    };
}
