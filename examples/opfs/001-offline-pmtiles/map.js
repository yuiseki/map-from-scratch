export async function mount(canvas, archiveUrl) {
    const ctx = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    let networkRequests = 0;
    const origFetch = window.fetch;
    window.fetch = async (...args)=>{
        networkRequests++;
        return origFetch(...args);
    };
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
        type: 'module'
    });
    let mx = 0.5;
    let my = 0.5 - Math.log(Math.tan(Math.PI / 4 + 20 * Math.PI / 360)) / (2 * Math.PI);
    let zoom = 1.2;
    let dpr = 1;
    function resize() {
        dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    resize();
    const tileCache = new Map();
    let inFlight = new Set();
    let opfsStats = {
        totalSyncReads: 0,
        avgLatencyMs: 0,
        opfsSize: 0,
        networkRequests: 0,
        cachedTiles: 0
    };
    let tileIdCounter = 0;
    const pendingRequests = new Map();
    worker.onmessage = (e)=>{
        const msg = e.data;
        if (msg.type === 'tile') {
            const key = `${msg.z}/${msg.x}/${msg.y}`;
            inFlight.delete(key);
            tileCache.set(key, {
                rings: msg.rings
            });
            if (pendingRequests.has(msg.id)) {
                pendingRequests.get(msg.id)(msg.rings);
                pendingRequests.delete(msg.id);
            }
            render();
            if (mapInstance.onTileLoaded) mapInstance.onTileLoaded();
        } else if (msg.type === 'stats') {
            opfsStats.totalSyncReads = msg.totalSyncReads;
            opfsStats.avgLatencyMs = msg.avgLatencyMs;
            opfsStats.opfsSize = msg.opfsSize;
            opfsStats.cachedTiles = tileCache.size;
            opfsStats.networkRequests = networkRequests;
        }
    };
    await new Promise((resolve, reject)=>{
        const handler = (e)=>{
            if (e.data.type === 'ready') {
                opfsStats.opfsSize = e.data.opfsSize;
                resolve();
            } else if (e.data.type === 'error') {
                reject(new Error(e.data.message));
            }
        };
        worker.addEventListener('message', handler, {
            once: true
        });
        worker.postMessage({
            type: 'init',
            archiveUrl
        });
    });
    function render() {
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        const zi = Math.max(0, Math.min(2, Math.floor(zoom)));
        const n = 1 << zi;
        const world = 256 * Math.pow(2, zoom);
        const tileSize = world / n;
        const k0 = Math.floor(mx - w / 2 / world), k1 = Math.floor(mx + w / 2 / world);
        for(let k = k0; k <= k1; k++)for(let x = 0; x < n; x++){
            for(let y = 0; y < n; y++){
                const tileLeft = w / 2 + (k + x / n - mx) * world;
                const tileTop = h / 2 + (y / n - my) * world;
                if (tileLeft + tileSize < 0 || tileLeft > w || tileTop + tileSize < 0 || tileTop > h) {
                    continue;
                }
                const key = `${zi}/${x}/${y}`;
                const cached = tileCache.get(key);
                if (!cached) {
                    if (!inFlight.has(key)) {
                        inFlight.add(key);
                        const reqId = ++tileIdCounter;
                        worker.postMessage({
                            type: 'getTile',
                            id: reqId,
                            z: zi,
                            x,
                            y
                        });
                    }
                    continue;
                }
                ctx.save();
                ctx.fillStyle = '#1e293b';
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 1;
                for (const ring of cached.rings){
                    if (ring.length < 6) continue;
                    const X = (i)=>tileLeft + ring[i] * tileSize, Y = (i)=>tileTop + ring[i + 1] * tileSize;
                    ctx.beginPath();
                    ctx.moveTo(X(0), Y(0));
                    for(let i = 2; i < ring.length; i += 2)ctx.lineTo(X(i), Y(i));
                    ctx.closePath();
                    ctx.fill();
                    ctx.beginPath();
                    const m = ring.length;
                    for(let i = 0; i < m; i += 2){
                        const j = (i + 2) % m, ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1];
                        const cut = ax === bx && (ax <= 0 || ax >= 1) || ay === by && (ay <= 0 || ay >= 1);
                        if (!cut) {
                            ctx.moveTo(X(i), Y(i));
                            ctx.lineTo(X(j), Y(j));
                        }
                    }
                    ctx.stroke();
                }
                ctx.strokeStyle = 'rgba(71, 85, 105, 0.2)';
                ctx.strokeRect(tileLeft, tileTop, tileSize, tileSize);
                ctx.restore();
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
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        panBy(dx, dy);
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
    function panBy(dx, dy) {
        const world = 256 * Math.pow(2, zoom);
        mx -= dx / world;
        mx -= Math.floor(mx);
        my = Math.max(0, Math.min(1, my - dy / world));
        render();
    }
    function zoomAt(z, px, py) {
        const ox = px - canvas.width / dpr / 2, oy = py - canvas.height / dpr / 2;
        const before = 256 * Math.pow(2, zoom);
        zoom = Math.max(0.5, Math.min(2.8, z));
        const after = 256 * Math.pow(2, zoom);
        mx += ox / before - ox / after;
        my = Math.max(0, Math.min(1, my + oy / before - oy / after));
        render();
    }
    canvas.addEventListener('wheel', (e)=>{
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomAt(zoom - e.deltaY * 0.002, e.clientX - rect.left, e.clientY - rect.top);
    }, {
        passive: false
    });
    window.addEventListener('resize', ()=>{
        resize();
        render();
    });
    render();
    const mapInstance = {
        canvas,
        ctx,
        render,
        panBy,
        worldPx: ()=>256 * Math.pow(2, zoom),
        zoomBy (delta) {
            zoomAt(zoom + delta, canvas.width / dpr / 2, canvas.height / dpr / 2);
        },
        async getStats () {
            return new Promise((resolve)=>{
                const handler = (e)=>{
                    if (e.data.type === 'stats') {
                        worker.removeEventListener('message', handler);
                        resolve({
                            totalSyncReads: e.data.totalSyncReads,
                            avgLatencyMs: e.data.avgLatencyMs,
                            opfsSize: e.data.opfsSize,
                            networkRequests,
                            cachedTiles: tileCache.size
                        });
                    }
                };
                worker.addEventListener('message', handler);
                worker.postMessage({
                    type: 'getStats'
                });
            });
        },
        readPixel (x, y) {
            return ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        }
    };
    return mapInstance;
}
