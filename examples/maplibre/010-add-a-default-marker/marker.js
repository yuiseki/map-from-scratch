const DC_LNG = -77.0369;
const DC_LAT = 38.9072;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const targetMx = (DC_LNG + 180) / 360;
const targetMy = mercY(DC_LAT);
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!ctx) throw new Error('2D context not available');
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
    const polygons = await res.json();
    let centerMx = targetMx;
    let centerMy = targetMy;
    let zoom = 5;
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
    function getMarkerScreenPos() {
        const scale = 256 * Math.pow(2, zoom);
        const sx = width / 2 + (targetMx - centerMx) * scale;
        const sy = height / 2 + (targetMy - centerMy) * scale;
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
        const [mx, my] = getMarkerScreenPos();
        ctx.save();
        ctx.translate(mx, my);
        ctx.beginPath();
        ctx.ellipse(0, 2, 7, 3, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-3, -8, -13, -19, -13, -29);
        ctx.arc(0, -29, 13, Math.PI, 0, false);
        ctx.bezierCurveTo(13, -19, 3, -8, 0, 0);
        ctx.closePath();
        ctx.fillStyle = '#3FB1CE';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -29, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
        ctx.restore();
    }
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    function onPointerDown(e) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
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
    function onWheel(e) {
        e.preventDefault();
        const delta = -e.deltaY * 0.002;
        zoomAt(e, zoom + delta);
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
        getMarkerScreenPos,
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
