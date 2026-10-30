function projectMercator(lon, lat) {
    const x = (lon + 180) / 360;
    const sin = Math.sin(lat * Math.PI / 180);
    const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
    const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
    return [
        x,
        y
    ];
}
export async function mount(canvas, dataUrl) {
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!ctx) throw new Error('Failed to get Canvas 2D context');
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Failed to load arcs data: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const view = new DataView(buffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'DARC') throw new Error(`Invalid magic: ${magic}`);
    const countyCount = view.getUint16(6, true);
    const flowCount = view.getUint32(8, true);
    const landRingCount = view.getUint16(12, true);
    const nameBytes = view.getUint32(14, true);
    let offset = 32;
    const centroids = new Float32Array(buffer, offset, countyCount * 2);
    offset += countyCount * 2 * 4;
    const flows = [];
    for(let i = 0; i < flowCount; i++){
        const s = view.getUint16(offset, true);
        const t = view.getUint16(offset + 2, true);
        const v = view.getInt32(offset + 4, true);
        flows.push({
            s,
            t,
            v
        });
        offset += 8;
    }
    const landRings = [];
    for(let r = 0; r < landRingCount; r++){
        const ptCount = view.getUint32(offset, true);
        offset += 4;
        const ring = new Float32Array(buffer, offset, ptCount * 2);
        landRings.push(ring);
        offset += ptCount * 2 * 4;
    }
    const namesBuf = new Uint8Array(buffer, offset, nameBytes);
    const names = JSON.parse(new TextDecoder().decode(namesBuf));
    let selectedCountyIdx = names.indexOf('Los Angeles, CA');
    if (selectedCountyIdx < 0) selectedCountyIdx = 0;
    let activeArcCount = 0;
    let activeFlows = [];
    function updateActiveFlows() {
        activeFlows = [];
        if (selectedCountyIdx >= 0) {
            for (const fl of flows){
                if (fl.s === selectedCountyIdx) activeFlows.push(fl);
            }
            activeFlows.sort((a, b)=>Math.abs(b.v) - Math.abs(a.v));
            if (activeFlows.length > 200) {
                activeFlows = activeFlows.slice(0, 200);
            }
        } else {
            activeFlows.push(...flows.slice(0, 300));
        }
        activeArcCount = activeFlows.length;
        activeFlows.sort((a, b)=>Math.abs(a.v) - Math.abs(b.v));
    }
    updateActiveFlows();
    const [initMx, initMy] = projectMercator(-98.5, 39.5);
    let centerMx = initMx;
    let centerMy = initMy;
    let zoom = 3.9;
    let width = canvas.clientWidth || 1280;
    let height = canvas.clientHeight || 800;
    let dpr = window.devicePixelRatio || 1;
    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth || 1280;
        height = canvas.clientHeight || 800;
        const targetW = Math.round(width * dpr);
        const targetH = Math.round(height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }
    }
    resize();
    window.addEventListener('resize', ()=>{
        resize();
        render();
    });
    function render() {
        const w = canvas.width;
        const h = canvas.height;
        const scale = 256 * Math.pow(2, zoom) * dpr;
        const toScreenX = (mx)=>(mx - centerMx) * scale + w / 2;
        const toScreenY = (my)=>(my - centerMy) * scale + h / 2;
        ctx.fillStyle = '#0f1422';
        ctx.fillRect(0, 0, w, h);
        ctx.beginPath();
        for (const ring of landRings){
            const len = ring.length;
            if (len < 4) continue;
            ctx.moveTo(toScreenX(ring[0]), toScreenY(ring[1]));
            for(let i = 2; i < len; i += 2){
                ctx.lineTo(toScreenX(ring[i]), toScreenY(ring[i + 1]));
            }
            ctx.closePath();
        }
        ctx.fillStyle = '#1c2438';
        ctx.fill();
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const fl of activeFlows){
            if (fl.v >= 0) continue;
            const sIdx = fl.s * 2;
            const tIdx = fl.t * 2;
            const x0 = toScreenX(centroids[sIdx]);
            const y0 = toScreenY(centroids[sIdx + 1]);
            const x1 = toScreenX(centroids[tIdx]);
            const y1 = toScreenY(centroids[tIdx + 1]);
            if (x0 < -100 && x1 < -100 || x0 > w + 100 && x1 > w + 100 || y0 < -100 && y1 < -100 || y0 > h + 100 && y1 > h + 100) continue;
            const dist = Math.hypot(x1 - x0, y1 - y0);
            if (dist < 1) continue;
            const arcHeight = Math.min(dist * 0.28, 160 * dpr);
            const xm = (x0 + x1) * 0.5;
            const ym = (y0 + y1) * 0.5 - 2 * arcHeight;
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(xm, ym, x1, y1);
        }
        ctx.strokeStyle = '#f95d3a';
        ctx.lineWidth = 1.6 * dpr;
        ctx.stroke();
        ctx.beginPath();
        for (const fl of activeFlows){
            if (fl.v < 0) continue;
            const sIdx = fl.s * 2;
            const tIdx = fl.t * 2;
            const x0 = toScreenX(centroids[sIdx]);
            const y0 = toScreenY(centroids[sIdx + 1]);
            const x1 = toScreenX(centroids[tIdx]);
            const y1 = toScreenY(centroids[tIdx + 1]);
            if (x0 < -100 && x1 < -100 || x0 > w + 100 && x1 > w + 100 || y0 < -100 && y1 < -100 || y0 > h + 100 && y1 > h + 100) continue;
            const dist = Math.hypot(x1 - x0, y1 - y0);
            if (dist < 1) continue;
            const arcHeight = Math.min(dist * 0.28, 160 * dpr);
            const xm = (x0 + x1) * 0.5;
            const ym = (y0 + y1) * 0.5 - 2 * arcHeight;
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(xm, ym, x1, y1);
        }
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.6 * dpr;
        ctx.stroke();
        ctx.beginPath();
        for (const fl of activeFlows){
            const other = fl.s === selectedCountyIdx ? fl.t : fl.s;
            const ox = toScreenX(centroids[other * 2]);
            const oy = toScreenY(centroids[other * 2 + 1]);
            if (ox >= 0 && ox <= w && oy >= 0 && oy <= h) {
                ctx.rect(Math.round(ox - 2 * dpr), Math.round(oy - 2 * dpr), Math.round(4 * dpr), Math.round(4 * dpr));
            }
        }
        ctx.fillStyle = '#64d2ff';
        ctx.fill();
        if (selectedCountyIdx >= 0) {
            const sx = toScreenX(centroids[selectedCountyIdx * 2]);
            const sy = toScreenY(centroids[selectedCountyIdx * 2 + 1]);
            if (sx >= -50 && sx <= w + 50 && sy >= -50 && sy <= h + 50) {
                ctx.fillStyle = '#f59e0b';
                ctx.beginPath();
                ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (e)=>{
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!dragging) return;
        const dpr = window.devicePixelRatio || 1;
        const scale = 256 * Math.pow(2, zoom) * dpr;
        const dx = (e.clientX - lastX) * dpr;
        const dy = (e.clientY - lastY) * dpr;
        centerMx -= dx / scale;
        centerMy -= dy / scale;
        lastX = e.clientX;
        lastY = e.clientY;
        render();
    });
    const stopDrag = (e)=>{
        if (dragging) {
            dragging = false;
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const dpr = window.devicePixelRatio || 1;
        const scale = 256 * Math.pow(2, zoom) * dpr;
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) * dpr;
        const mouseY = (e.clientY - rect.top) * dpr;
        const mx = centerMx + (mouseX - canvas.width / 2) / scale;
        const my = centerMy + (mouseY - canvas.height / 2) / scale;
        const zoomDelta = -e.deltaY * 0.002;
        zoom = Math.max(2.5, Math.min(8.0, zoom + zoomDelta));
        const newScale = 256 * Math.pow(2, zoom) * dpr;
        centerMx = mx - (mouseX - canvas.width / 2) / newScale;
        centerMy = my - (mouseY - canvas.height / 2) / newScale;
        render();
    }, {
        passive: false
    });
    render();
    return {
        canvas,
        ctx,
        countyCount,
        flowCount,
        get activeArcCount () {
            return activeArcCount;
        },
        get selectedCountyIdx () {
            return selectedCountyIdx;
        },
        get selectedCountyName () {
            return names[selectedCountyIdx] || '';
        },
        names,
        render,
        panBy (dx, dy) {
            const dpr = window.devicePixelRatio || 1;
            const scale = 256 * Math.pow(2, zoom) * dpr;
            centerMx -= dx * dpr / scale;
            centerMy -= dy * dpr / scale;
            render();
        },
        setZoom (z) {
            zoom = z;
            render();
        },
        selectCounty (idx) {
            selectedCountyIdx = idx;
            updateActiveFlows();
            render();
        },
        getCenter () {
            const lon = centerMx * 360 - 180;
            const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * centerMy))) * 180 / Math.PI;
            return {
                lon,
                lat,
                zoom
            };
        }
    };
}
