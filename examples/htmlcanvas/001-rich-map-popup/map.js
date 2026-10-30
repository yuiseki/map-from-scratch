import { openArchive } from './pmtiles.js';
export async function mount(canvas, dataUrl) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    const hasDrawElementImage = typeof ctx.drawElementImage === 'function';
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Failed to load landmarks: ${res.status}`);
    const landmarks = await res.json();
    let activeLandmark = landmarks[0];
    let bookmarked = false;
    const popup = document.getElementById('map-popup');
    const popupTitle = document.getElementById('popup-title');
    const popupBadge = document.getElementById('popup-badge');
    const popupAddress = document.getElementById('popup-address');
    const popupDesc = document.getElementById('popup-desc');
    const popupBtn = document.getElementById('popup-btn');
    const popupLink = document.getElementById('popup-link');
    function updateDomContent() {
        if (popupTitle) popupTitle.textContent = activeLandmark.name;
        if (popupBadge) popupBadge.textContent = activeLandmark.category;
        if (popupAddress) popupAddress.textContent = activeLandmark.address;
        if (popupDesc) popupDesc.textContent = activeLandmark.description;
        if (popupBtn) {
            popupBtn.textContent = bookmarked ? '保存済み ✓' : '保存する';
            if (bookmarked) popupBtn.classList.add('active');
            else popupBtn.classList.remove('active');
        }
        if (popupLink) popupLink.href = activeLandmark.url;
    }
    async function toggleBookmark() {
        bookmarked = !bookmarked;
        await render();
        return bookmarked;
    }
    popupBtn.addEventListener('click', ()=>{
        toggleBookmark();
    });
    const SIZE = 512;
    let zoom = 14;
    const world = ()=>SIZE * 2 ** zoom;
    const mercator = (lon, lat)=>({
            x: (lon + 180) / 360 * world(),
            y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * world()
        });
    let center = mercator(139.755, 35.668);
    let archive = null;
    const images = new Map();
    const pending = new Set();
    function requestTile(z, x, y) {
        if (!archive) return;
        const key = `${z}/${x}/${y}`;
        if (images.has(key) || pending.has(key) || pending.size >= 8) return;
        pending.add(key);
        archive.tile(z, x, y).then((bytes)=>bytes ? createImageBitmap(new Blob([
                Uint8Array.from(bytes)
            ], {
                type: 'image/jpeg'
            })) : null).then((image)=>{
            images.set(key, image);
            if (images.size > 64) {
                const oldest = images.keys().next().value;
                images.get(oldest)?.close();
                images.delete(oldest);
            }
        }).catch(()=>{
            images.set(key, null);
        }).finally(()=>{
            pending.delete(key);
            render();
        });
    }
    function project(lon, lat) {
        const m = mercator(lon, lat);
        return {
            x: canvas.width / 2 + (m.x - center.x),
            y: canvas.height / 2 + (m.y - center.y)
        };
    }
    function unproject(px, py) {
        const mx = center.x + (px - canvas.width / 2);
        const my = center.y + (py - canvas.height / 2);
        const lon = mx / world() * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my / world()))) * (180 / Math.PI);
        return {
            lon,
            lat
        };
    }
    function getAnchorPos() {
        return project(activeLandmark.lon, activeLandmark.lat);
    }
    function getPopupRect() {
        const anchor = getAnchorPos();
        const w = popup.offsetWidth || 260;
        const h = popup.offsetHeight || 140;
        const px = Math.round(anchor.x - w / 2);
        const py = Math.round(anchor.y - h - 14);
        return {
            x: px,
            y: py,
            width: w,
            height: h
        };
    }
    function getButtonRect() {
        const pRect = getPopupRect();
        const bRect = popupBtn.getBoundingClientRect();
        const parentRect = popup.getBoundingClientRect();
        const bx = pRect.x + (bRect.x - parentRect.x);
        const by = pRect.y + (bRect.y - parentRect.y);
        return {
            x: bx,
            y: by,
            width: bRect.width,
            height: bRect.height
        };
    }
    async function render() {
        updateDomContent();
        if (typeof canvas.requestPaint === 'function') {
            await new Promise((resolve)=>{
                canvas.addEventListener('paint', ()=>resolve(), {
                    once: true
                });
                canvas.requestPaint();
            });
        } else {
            await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
        }
        const w = canvas.width;
        const h = canvas.height;
        ctx.fillStyle = '#132332';
        ctx.fillRect(0, 0, w, h);
        const left = center.x - w / 2;
        const top = center.y - h / 2;
        const max = 2 ** zoom;
        const x0 = Math.max(0, Math.floor(left / SIZE));
        const y0 = Math.max(0, Math.floor(top / SIZE));
        const x1 = Math.min(max - 1, Math.floor((left + w) / SIZE));
        const y1 = Math.min(max - 1, Math.floor((top + h) / SIZE));
        for(let y = y0; y <= y1; y++){
            for(let x = x0; x <= x1; x++){
                const key = `${zoom}/${x}/${y}`;
                const img = images.get(key);
                if (img) {
                    const px0 = Math.round(x * SIZE - left);
                    const py0 = Math.round(y * SIZE - top);
                    const px1 = Math.round((x + 1) * SIZE - left);
                    const py1 = Math.round((y + 1) * SIZE - top);
                    ctx.drawImage(img, px0, py0, px1 - px0, py1 - py0);
                } else if (!images.has(key)) {
                    requestTile(zoom, x, y);
                }
            }
        }
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([
            4,
            4
        ]);
        ctx.beginPath();
        landmarks.forEach((l, idx)=>{
            const pt = project(l.lon, l.lat);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        for (const lm of landmarks){
            const pt = project(lm.lon, lm.lat);
            const isActive = lm.id === activeLandmark.id;
            ctx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.5)' : 'rgba(15, 23, 42, 0.6)';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isActive ? 16 : 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = isActive ? '#38bdf8' : '#e2e8f0';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isActive ? 7 : 5, 0, Math.PI * 2);
            ctx.fill();
            const labelText = lm.name;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            const textMetrics = ctx.measureText(labelText);
            const bgW = textMetrics.width + 8;
            const bgH = 16;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            ctx.fillRect(pt.x - bgW / 2, pt.y + 10, bgW, bgH);
            ctx.fillStyle = '#f8fafc';
            ctx.fillText(labelText, pt.x, pt.y + 22);
        }
        const pRect = getPopupRect();
        const anchor = getAnchorPos();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(anchor.x - 8, pRect.y + pRect.height);
        ctx.lineTo(anchor.x + 8, pRect.y + pRect.height);
        ctx.lineTo(anchor.x, anchor.y);
        ctx.closePath();
        ctx.fill();
        if (hasDrawElementImage) {
            ctx.drawElementImage(popup, pRect.x, pRect.y);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(pRect.x, pRect.y, pRect.width, pRect.height);
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 15px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(activeLandmark.name, pRect.x + 14, pRect.y + 24);
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#334155';
            ctx.fillText(activeLandmark.description.slice(0, 20), pRect.x + 14, pRect.y + 50);
        }
    }
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    canvas.addEventListener('pointerdown', (e)=>{
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const bRect = getButtonRect();
        if (cx >= bRect.x && cx <= bRect.x + bRect.width && cy >= bRect.y && cy <= bRect.y + bRect.height) {
            popupBtn.click();
            return;
        }
        for (const lm of landmarks){
            const pt = project(lm.lon, lm.lat);
            const dist = Math.hypot(cx - pt.x, cy - pt.y);
            if (dist < 18) {
                activeLandmark = lm;
                render();
                return;
            }
        }
        isDragging = true;
        dragStartX = cx;
        dragStartY = cy;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e)=>{
        if (!isDragging) return;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const dx = cx - dragStartX;
        const dy = cy - dragStartY;
        dragStartX = cx;
        dragStartY = cy;
        center.x -= dx;
        center.y -= dy;
        render();
    });
    const stopDrag = (e)=>{
        if (isDragging) {
            isDragging = false;
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    function zoomAt(z, px, py) {
        const next = Math.max(10, Math.min(17, z));
        const k = 2 ** (next - zoom);
        const ox = px - canvas.width / 2, oy = py - canvas.height / 2;
        center = {
            x: (center.x + ox) * k - ox,
            y: (center.y + oy) * k - oy
        };
        zoom = next;
    }
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomAt(zoom + (e.deltaY < 0 ? 1 : -1), (e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height);
        render();
    }, {
        passive: false
    });
    async function panBy(dx, dy) {
        center.x -= dx;
        center.y -= dy;
        await render();
    }
    async function zoomBy(delta) {
        zoomAt(zoom + delta, canvas.width / 2, canvas.height / 2);
        await render();
    }
    function readPixel(x, y) {
        const rx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
        const ry = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
        return ctx.getImageData(rx, ry, 1, 1).data;
    }
    async function clickButton() {
        return await toggleBookmark();
    }
    async function waitForTile(timeoutMs = 6000) {
        const start = performance.now();
        while(performance.now() - start < timeoutMs){
            for (const img of images.values()){
                if (img) return true;
            }
            await new Promise((r)=>setTimeout(r, 60));
        }
        return false;
    }
    function hasAerialTiles() {
        for (const img of images.values()){
            if (img) return true;
        }
        return false;
    }
    try {
        archive = await openArchive();
        const cx = Math.floor(center.x / SIZE);
        const cy = Math.floor(center.y / SIZE);
        requestTile(zoom, cx, cy);
    } catch (err) {
        console.warn('Seamlessphoto PMTiles error:', err);
    }
    await render();
    return {
        canvas,
        landmarks,
        activeLandmark,
        get bookmarked () {
            return bookmarked;
        },
        hasDrawElementImage,
        render,
        panBy,
        zoomBy,
        getAnchorPos,
        getPopupRect,
        getButtonRect,
        clickButton,
        readPixel,
        waitForTile,
        hasAerialTiles
    };
}
