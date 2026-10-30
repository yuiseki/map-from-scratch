const PIN_W = 32;
const PIN_H = 44;
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const invMercY = (my)=>Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360 / Math.PI - 90;
const START_LNG = -66.324;
const START_LAT = -16.498;
function makePinSprite(scale) {
    const c = document.createElement('canvas');
    c.width = Math.round(PIN_W * scale);
    c.height = Math.round(PIN_H * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = '#1e6fd9';
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(8, 22);
    g.lineTo(16, 42);
    g.lineTo(24, 22);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(16, 15, 11, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(16, 15, 4, 0, Math.PI * 2);
    g.fill();
    return c;
}
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!ctx) throw new Error('2D context not available');
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
    const polygons = await res.json();
    let centerMx = mercX(START_LNG);
    let centerMy = mercY(START_LAT);
    let zoom = 3;
    let markerMx = centerMx;
    let markerMy = centerMy;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    let sprite = makePinSprite(dpr);
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        sprite = makePinSprite(dpr);
        draw();
    }
    function getMarkerScreenPos() {
        const scale = 256 * Math.pow(2, zoom);
        return [
            width / 2 + (markerMx - centerMx) * scale,
            height / 2 + (markerMy - centerMy) * scale
        ];
    }
    function draw() {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#aad3df';
        ctx.fillRect(0, 0, width, height);
        const scale = 256 * Math.pow(2, zoom);
        const originX = width / 2 - centerMx * scale;
        const originY = height / 2 - centerMy * scale;
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
        const [mx, my] = getMarkerScreenPos();
        ctx.drawImage(sprite, mx - PIN_W / 2, my - PIN_H, PIN_W, PIN_H);
        ctx.restore();
    }
    let draggingMarker = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let grabDX = 0;
    let grabDY = 0;
    function localPoint(e) {
        const rect = canvas.getBoundingClientRect();
        return [
            e.clientX - rect.left,
            e.clientY - rect.top
        ];
    }
    function hitsMarker(x, y) {
        const [mx, my] = getMarkerScreenPos();
        return Math.abs(x - mx) <= PIN_W / 2 + 2 && y >= my - PIN_H - 2 && y <= my + 6;
    }
    function onPointerDown(e) {
        const [x, y] = localPoint(e);
        lastX = e.clientX;
        lastY = e.clientY;
        if (hitsMarker(x, y)) {
            draggingMarker = true;
            const [mx, my] = getMarkerScreenPos();
            grabDX = mx - x;
            grabDY = my - y;
        } else {
            panning = true;
        }
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
    }
    function onPointerMove(e) {
        if (draggingMarker) {
            const [x, y] = localPoint(e);
            const scale = 256 * Math.pow(2, zoom);
            markerMx = centerMx + (x + grabDX - width / 2) / scale;
            markerMy = Math.max(0, Math.min(1, centerMy + (y + grabDY - height / 2) / scale));
            draw();
            return;
        }
        if (!panning) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        panBy(dx, dy);
    }
    function onPointerUp(e) {
        draggingMarker = false;
        panning = false;
        try {
            canvas.releasePointerCapture(e.pointerId);
        } catch  {}
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
        const [x, y] = localPoint(e);
        zoomAtPoint(x, y, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
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
    function resetView() {
        centerMx = mercX(START_LNG);
        centerMy = mercY(START_LAT);
        markerMx = centerMx;
        markerMy = centerMy;
        zoom = 3;
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
        getMarkerLngLat: ()=>[
                markerMx * 360 - 180,
                invMercY(markerMy)
            ],
        isDraggingMarker: ()=>draggingMarker,
        resetView,
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
