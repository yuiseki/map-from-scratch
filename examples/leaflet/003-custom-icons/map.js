export const ICONS = [
    {
        id: 'pin',
        lat: 51.5,
        lng: -0.09,
        text: 'I am the pin icon.',
        color: '#2A81CB',
        stroke: '#1b5f99',
        kind: 'pin'
    },
    {
        id: 'square',
        lat: 51.5145,
        lng: -0.115,
        text: 'I am the square icon.',
        color: '#E8590C',
        stroke: '#a83a06',
        kind: 'square'
    },
    {
        id: 'circle',
        lat: 51.494,
        lng: -0.055,
        text: 'I am the circle icon.',
        color: '#2F9E44',
        stroke: '#227332',
        kind: 'circle'
    }
];
const LONDON_LAT = 51.505;
const LONDON_LNG = -0.09;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const latFromMercY = (my)=>(Math.atan(Math.exp((1 - 2 * my) * Math.PI)) - Math.PI / 4) * 360 / Math.PI;
const HIT_RADIUS = 18;
function drawIcon(ctx, icon, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.ellipse(3, 1, 9, 3.5, 0.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();
    ctx.fillStyle = icon.color;
    ctx.strokeStyle = icon.stroke;
    ctx.lineWidth = 1.5;
    if (icon.kind === 'pin') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-3.5, -8, -10, -14, -10, -21);
        ctx.arc(0, -21, 10, Math.PI, 0, false);
        ctx.bezierCurveTo(10, -14, 3.5, -8, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -21, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    } else if (icon.kind === 'square') {
        ctx.beginPath();
        ctx.roundRect(-11, -25, 22, 22, 5);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.rect(-4, -18, 8, 8);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.arc(0, -12, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -12, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }
    ctx.restore();
}
const ICON_TOP = 26;
export async function mount(canvas, landUrl) {
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!ctx) throw new Error('2D context not available');
    const res = await fetch(landUrl);
    if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
    const polygons = await res.json();
    let centerMx = (LONDON_LNG + 180) / 360;
    let centerMy = mercY(LONDON_LAT);
    let zoom = 13;
    let dpr = window.devicePixelRatio || 1;
    let width = canvas.clientWidth || 800;
    let height = canvas.clientHeight || 600;
    let activePopup = null;
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 800;
        height = canvas.clientHeight || 600;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        draw();
    }
    function getScreenPos(lat, lng) {
        const scale = 256 * Math.pow(2, zoom);
        const mx = (lng + 180) / 360;
        const my = mercY(lat);
        return [
            width / 2 + (mx - centerMx) * scale,
            height / 2 + (my - centerMy) * scale
        ];
    }
    function screenToLatLng(sx, sy) {
        const scale = 256 * Math.pow(2, zoom);
        const mx = centerMx + (sx - width / 2) / scale;
        const my = centerMy + (sy - height / 2) / scale;
        return [
            latFromMercY(my),
            mx * 360 - 180
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
        ctx.fillStyle = '#f2efe9';
        ctx.strokeStyle = '#d9d4c7';
        ctx.lineWidth = 1;
        for (const poly of polygons){
            if (poly.length === 0) continue;
            ctx.beginPath();
            for (const ring of poly){
                for(let i = 0; i < ring.length; i++){
                    const rx = originX + ring[i][0] * scale;
                    const ry = originY + ring[i][1] * scale;
                    if (i === 0) ctx.moveTo(rx, ry);
                    else ctx.lineTo(rx, ry);
                }
            }
            ctx.fill();
            ctx.stroke();
        }
        for (const icon of ICONS){
            const [x, y] = getScreenPos(icon.lat, icon.lng);
            drawIcon(ctx, icon, x, y);
        }
        if (activePopup) {
            const [px, py] = getScreenPos(activePopup.lat, activePopup.lng);
            ctx.save();
            ctx.font = '13px system-ui, sans-serif';
            const textWidth = ctx.measureText(activePopup.text).width;
            const pw = Math.max(140, textWidth + 24);
            const ph = 36;
            const popX = px - pw / 2;
            const popY = py - activePopup.lift - ph;
            ctx.shadowColor = 'rgba(0,0,0,0.25)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 3;
            ctx.beginPath();
            ctx.roundRect(popX, popY, pw, ph, 8);
            ctx.moveTo(px - 7, popY + ph);
            ctx.lineTo(px, popY + ph + 8);
            ctx.lineTo(px + 7, popY + ph);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = '#222222';
            ctx.fillText(activePopup.text, popX + 12, popY + 22);
            ctx.restore();
        }
        ctx.restore();
    }
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    let downX = 0;
    let downY = 0;
    function onPointerDown(e) {
        dragging = true;
        moved = false;
        lastX = downX = e.clientX;
        lastY = downY = e.clientY;
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch  {}
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
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
            if (!moved) clickAtScreen(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top);
        }
    }
    function clickAtScreen(sx, sy) {
        for (const icon of ICONS){
            const [x, y] = getScreenPos(icon.lat, icon.lng);
            if (Math.hypot(sx - x, sy - (y - 16)) <= HIT_RADIUS) {
                activePopup = {
                    text: icon.text,
                    lat: icon.lat,
                    lng: icon.lng,
                    lift: ICON_TOP + 12
                };
                draw();
                return;
            }
        }
        const [lat, lng] = screenToLatLng(sx, sy);
        activePopup = {
            text: `You clicked at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            lat,
            lng,
            lift: 10
        };
        draw();
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
        zoom = Math.max(2, Math.min(18, z));
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
        get activePopup () {
            return activePopup;
        },
        draw,
        panBy,
        setZoom,
        zoomAtPoint,
        clickAtScreen,
        getScreenPos,
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
