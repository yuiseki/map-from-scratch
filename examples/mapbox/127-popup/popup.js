const US_CENTER_LNG = -96.0;
const US_CENTER_LAT = 37.8;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const defaultCenterMx = mercX(US_CENTER_LNG);
const defaultCenterMy = mercY(US_CENTER_LAT);
export async function mount(canvas, landUrl = '../../../data/baked/mapbox-127-popup/land.json') {
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
    let popupVisible = true;
    const popupLngLat = [
        US_CENTER_LNG,
        US_CENTER_LAT
    ];
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
    function getPopupBounds() {
        const [tipX, tipY] = getScreenPos(popupLngLat[0], popupLngLat[1]);
        const bubbleW = 140;
        const bubbleH = 44;
        const tipH = 10;
        const bx = tipX - bubbleW / 2;
        const by = tipY - tipH - bubbleH;
        return {
            x: bx,
            y: by,
            width: bubbleW,
            height: bubbleH,
            closeBtn: {
                x: bx + bubbleW - 20,
                y: by + 6,
                size: 16
            }
        };
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
        if (popupVisible) {
            const [tipX, tipY] = getScreenPos(popupLngLat[0], popupLngLat[1]);
            const bounds = getPopupBounds();
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
            const r = 6;
            ctx.beginPath();
            ctx.moveTo(bounds.x + r, bounds.y);
            ctx.lineTo(bounds.x + bounds.width - r, bounds.y);
            ctx.arcTo(bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + r, r);
            ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height - r);
            ctx.arcTo(bounds.x + bounds.width, bounds.y + bounds.height, bounds.x + bounds.width - r, bounds.y + bounds.height, r);
            ctx.lineTo(tipX + 8, bounds.y + bounds.height);
            ctx.lineTo(tipX, tipY);
            ctx.lineTo(tipX - 8, bounds.y + bounds.height);
            ctx.lineTo(bounds.x + r, bounds.y + bounds.height);
            ctx.arcTo(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height - r, r);
            ctx.lineTo(bounds.x, bounds.y + r);
            ctx.arcTo(bounds.x, bounds.y, bounds.x + r, bounds.y, r);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#222222';
            ctx.font = 'bold 15px system-ui, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText('Hello World!', bounds.x + 14, bounds.y + bounds.height / 2);
            ctx.fillStyle = '#888888';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('×', bounds.closeBtn.x + bounds.closeBtn.size / 2, bounds.closeBtn.y + bounds.closeBtn.size / 2);
        }
        ctx.restore();
    }
    let dragging = false;
    let didDrag = false;
    let startX = 0;
    let startY = 0;
    function onPointerDown(e) {
        dragging = true;
        didDrag = false;
        startX = e.clientX;
        startY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            didDrag = true;
        }
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
        if (!didDrag) {
            const rect = canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            if (popupVisible) {
                const bounds = getPopupBounds();
                const btn = bounds.closeBtn;
                if (clickX >= btn.x && clickX <= btn.x + btn.size && clickY >= btn.y && clickY <= btn.y + btn.size) {
                    popupVisible = false;
                    draw();
                    return;
                }
            }
        }
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
        zoom = Math.max(1, Math.min(10, z));
        draw();
    }
    function setPopupVisible(visible) {
        popupVisible = visible;
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
        get popupLngLat () {
            return [
                popupLngLat[0],
                popupLngLat[1]
            ];
        },
        draw,
        panBy,
        setZoom,
        setPopupVisible,
        getScreenPos,
        getPopupBounds,
        destroy () {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', resize);
        }
    };
}
