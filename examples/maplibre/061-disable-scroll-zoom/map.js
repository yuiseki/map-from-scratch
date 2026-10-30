const PORTLAND_LNG = -122.65;
const PORTLAND_LAT = 45.52;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const defaultCenterMx = mercX(PORTLAND_LNG);
const defaultCenterMy = mercY(PORTLAND_LAT);
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
    let zoom = 3;
    let scrollZoomEnabled = false;
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
                ctx.stroke();
            }
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
        if (!scrollZoomEnabled) {
            return;
        }
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
        zoom = Math.max(1, Math.min(10, z));
        draw();
    }
    function setScrollZoom(enabled) {
        scrollZoomEnabled = enabled;
    }
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, {
        passive: false
    });
    window.addEventListener('resize', resize);
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
        get scrollZoomEnabled () {
            return scrollZoomEnabled;
        },
        draw,
        panBy,
        setZoom,
        setScrollZoom,
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
