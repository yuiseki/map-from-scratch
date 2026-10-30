const ICON_LNG = 0;
const ICON_LAT = 0;
const SPRITE_SIZE = 100;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const targetMx = (ICON_LNG + 180) / 360;
const targetMy = mercY(ICON_LAT);
function makeGradientSprite(scale) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(SPRITE_SIZE * scale);
    const g = c.getContext('2d');
    const gradient = g.createLinearGradient(0, 0, 0, c.height);
    gradient.addColorStop(0, 'rgba(255, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 255, 1)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, c.width, c.height);
    const image = g.getImageData(0, 0, c.width, c.height);
    const data = image.data;
    for(let i = 0; i < data.length; i += 4)data[i + 3] = data[i];
    g.putImageData(image, 0, 0);
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
    let centerMx = targetMx;
    let centerMy = targetMy;
    let zoom = 3;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    let sprite = makeGradientSprite(dpr);
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        sprite = makeGradientSprite(dpr);
        draw();
    }
    function getIconScreenPos() {
        const scale = 256 * Math.pow(2, zoom);
        return [
            width / 2 + (targetMx - centerMx) * scale,
            height / 2 + (targetMy - centerMy) * scale
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
        const [ix, iy] = getIconScreenPos();
        ctx.drawImage(sprite, ix - SPRITE_SIZE / 2, iy - SPRITE_SIZE / 2, SPRITE_SIZE, SPRITE_SIZE);
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
        getIconScreenPos,
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
