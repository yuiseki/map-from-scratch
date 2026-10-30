const CENTER_LNG = 179;
const CENTER_LAT = 0;
const DEFAULT_ZOOM = 0.01;
const PANEL_X = 12;
const PANEL_Y = 12;
const PANEL_W = 168;
const PAD = 8;
const HEADER_H = 24;
const ROW_H = 26;
const RADIO = 12;
const ACCENT = '#2a7ae2';
const OCEAN = '#aad3df';
const LAND = '#f0eee8';
const LAND_EDGE = '#d0cdc4';
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);
export async function mount(canvas, landUrl) {
    const rawCtx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!rawCtx) throw new Error('2D context not available');
    const ctx = rawCtx;
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
    const polygons = await res.json();
    let centerMx = defaultCenterMx;
    let centerMy = defaultCenterMy;
    let zoom = DEFAULT_ZOOM;
    let copies = true;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    function worldWidth() {
        return 256 * Math.pow(2, zoom);
    }
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        draw();
    }
    function getScreenPos(lon, lat) {
        const scale = worldWidth();
        return [
            width / 2 + (mercX(lon) - centerMx) * scale,
            height / 2 + (mercY(lat) - centerMy) * scale
        ];
    }
    function getPanelRect() {
        return {
            x: PANEL_X,
            y: PANEL_Y,
            width: PANEL_W,
            height: PAD + HEADER_H + 2 * ROW_H + PAD
        };
    }
    function getRowRect(i) {
        const p = getPanelRect();
        return {
            x: p.x,
            y: p.y + PAD + HEADER_H + i * ROW_H,
            width: p.width,
            height: ROW_H
        };
    }
    function getRadioRect(i) {
        const r = getRowRect(i);
        return {
            x: r.x + 10,
            y: r.y + (ROW_H - RADIO) / 2,
            width: RADIO,
            height: RADIO
        };
    }
    function drawPanel() {
        const p = getPanelRect();
        const r = 6;
        ctx.beginPath();
        ctx.moveTo(p.x + r, p.y);
        ctx.lineTo(p.x + p.width - r, p.y);
        ctx.arcTo(p.x + p.width, p.y, p.x + p.width, p.y + r, r);
        ctx.lineTo(p.x + p.width, p.y + p.height - r);
        ctx.arcTo(p.x + p.width, p.y + p.height, p.x + p.width - r, p.y + p.height, r);
        ctx.lineTo(p.x + r, p.y + p.height);
        ctx.arcTo(p.x, p.y + p.height, p.x, p.y + p.height - r, r);
        ctx.lineTo(p.x, p.y + r);
        ctx.arcTo(p.x, p.y + r, p.x + r, p.y, r);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.fill();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.fillStyle = '#1f3a52';
        ctx.fillText('World copies', p.x + 10, p.y + PAD + HEADER_H / 2);
        ctx.font = '12px system-ui, sans-serif';
        for(let i = 0; i < 2; i++){
            const on = copies === (i === 0);
            const b = getRadioRect(i);
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, b.width / 2, 0, Math.PI * 2);
            ctx.fillStyle = on ? ACCENT : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = on ? ACCENT : '#8a8a8a';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#333333';
            ctx.fillText(i === 0 ? 'On' : 'Off', b.x + b.width + 10, cy + 0.5);
        }
    }
    function draw() {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = OCEAN;
        ctx.fillRect(0, 0, width, height);
        const scale = worldWidth();
        const originX = width / 2 - centerMx * scale;
        const originY = height / 2 - centerMy * scale;
        ctx.fillStyle = LAND;
        ctx.strokeStyle = LAND_EDGE;
        ctx.lineWidth = 1;
        const minWrap = copies ? Math.floor(centerMx - width / (2 * scale)) : 0;
        const maxWrap = copies ? Math.floor(centerMx + width / (2 * scale)) : 0;
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
        drawPanel();
        ctx.restore();
    }
    function rowAt(x, y) {
        const p = getPanelRect();
        if (x < p.x || y < p.y || x > p.x + p.width || y > p.y + p.height) return -1;
        for(let i = 0; i < 2; i++){
            const r = getRowRect(i);
            if (y >= r.y && y < r.y + r.height) return i;
        }
        return -1;
    }
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e)=>{
        const rect = canvas.getBoundingClientRect();
        const row = rowAt(e.clientX - rect.left, e.clientY - rect.top);
        if (row >= 0) {
            setWorldCopies(row === 0);
            return;
        }
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
        zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
    }, {
        passive: false
    });
    window.addEventListener('resize', resize);
    function zoomAtPoint(x, y, z) {
        const before = worldWidth();
        const ox = x - width / 2;
        const oy = y - height / 2;
        centerMx += ox / before;
        centerMy += oy / before;
        setZoom(z);
        const after = worldWidth();
        centerMx -= ox / after;
        centerMy -= oy / after;
        draw();
    }
    function panBy(dx, dy) {
        const scale = worldWidth();
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        draw();
    }
    function setZoom(z) {
        zoom = Math.max(0, Math.min(8, z));
        draw();
    }
    function setWorldCopies(v) {
        copies = v;
        draw();
    }
    function resetView() {
        centerMx = defaultCenterMx;
        centerMy = defaultCenterMy;
        zoom = DEFAULT_ZOOM;
        copies = true;
        draw();
    }
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
        get worldCopies () {
            return copies;
        },
        worldWidth,
        setWorldCopies,
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        getScreenPos,
        getPanelRect,
        getRowRect,
        getRadioRect,
        resetView,
        destroy () {
            window.removeEventListener('resize', resize);
        }
    };
}
