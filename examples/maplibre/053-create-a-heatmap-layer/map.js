const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
export class MaplibreHeatmapMap {
    canvas;
    ctx;
    polygons = [];
    points = new Float32Array(0);
    pointCount = 0;
    center = {
        lon: -130,
        lat: 45
    };
    zoom = 2.5;
    dpr = 1;
    isDragging = false;
    dragStart = {
        x: 0,
        y: 0
    };
    onRender;
    kernelCanvas = null;
    heatmapCanvas = null;
    cache = {
        x: 0,
        y: 0,
        zoom: -1
    };
    constructor(canvas, onRender){
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context not available');
        this.ctx = ctx;
        this.onRender = onRender;
        this.initKernelSprite();
        this.resize();
        window.addEventListener('resize', ()=>{
            this.resize();
            this.updateHeatmapCache();
            this.draw();
        });
        this.setupInteractions();
    }
    initKernelSprite() {
        const r = 32;
        const size = r * 2;
        const offscreen = document.createElement('canvas');
        offscreen.width = size;
        offscreen.height = size;
        const octx = offscreen.getContext('2d');
        if (!octx) return;
        const grad = octx.createRadialGradient(r, r, 0, r, r, r);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.85)');
        grad.addColorStop(0.18, 'rgba(239, 68, 68, 0.55)');
        grad.addColorStop(0.40, 'rgba(245, 158, 11, 0.35)');
        grad.addColorStop(0.65, 'rgba(56, 189, 248, 0.18)');
        grad.addColorStop(0.85, 'rgba(30, 58, 138, 0.08)');
        grad.addColorStop(1.0, 'rgba(15, 23, 42, 0.0)');
        octx.fillStyle = grad;
        octx.beginPath();
        octx.arc(r, r, r, 0, Math.PI * 2);
        octx.fill();
        this.kernelCanvas = offscreen;
    }
    updateHeatmapCache() {
        if (!this.kernelCanvas || this.pointCount === 0) return;
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const scale = 256 * Math.pow(2, this.zoom);
        const cw = Math.ceil(w * 2), ch = Math.ceil(h * 2);
        const x0 = mercX(this.center.lon) - cw / 2 / scale;
        const y0 = mercY(this.center.lat) - ch / 2 / scale;
        const offscreen = this.heatmapCanvas ?? document.createElement('canvas');
        offscreen.width = cw;
        offscreen.height = ch;
        const octx = offscreen.getContext('2d');
        if (!octx) return;
        octx.globalCompositeOperation = 'lighter';
        const baseR = Math.max(16, Math.min(48, 22 * Math.pow(1.2, this.zoom - 2)));
        const pts = this.points;
        const count = this.pointCount;
        const kMin = Math.floor(x0), kMax = Math.floor(x0 + cw / scale);
        for(let k = kMin; k <= kMax; k++){
            for(let i = 0; i < count; i++){
                const idx = i * 3;
                const r = baseR * (0.7 + pts[idx + 2] * 0.6);
                const sx = (pts[idx] + k - x0) * scale;
                const sy = (pts[idx + 1] - y0) * scale;
                if (sx < -r || sy < -r || sx > cw + r || sy > ch + r) continue;
                octx.drawImage(this.kernelCanvas, sx - r, sy - r, r * 2, r * 2);
            }
        }
        octx.globalCompositeOperation = 'source-over';
        octx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        for(let k = kMin; k <= kMax; k++){
            for(let i = 0; i < count; i++){
                const sx = (pts[i * 3] + k - x0) * scale;
                const sy = (pts[i * 3 + 1] - y0) * scale;
                if (sx < 0 || sy < 0 || sx > cw || sy > ch) continue;
                octx.beginPath();
                octx.arc(sx, sy, 1.5, 0, Math.PI * 2);
                octx.fill();
            }
        }
        this.heatmapCanvas = offscreen;
        this.cache = {
            x: x0,
            y: y0,
            zoom: this.zoom
        };
    }
    async load(baseDir = '../../..') {
        const [landRes, eqRes] = await Promise.all([
            fetch(`${baseDir}/data/baked/maplibre-053-create-a-heatmap-layer/land.json`),
            fetch(`${baseDir}/data/baked/maplibre-053-create-a-heatmap-layer/earthquakes.bin`)
        ]);
        this.polygons = await landRes.json();
        const eqBuf = await eqRes.arrayBuffer();
        const count = new Uint32Array(eqBuf, 4, 1)[0];
        this.pointCount = count;
        this.points = new Float32Array(eqBuf, 8, count * 3);
        this.updateHeatmapCache();
        this.draw();
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
    }
    panBy(dx, dy) {
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon) - dx / scale;
        const centerMy = mercY(this.center.lat) - dy / scale;
        this.center.lon = centerMx * 360 - 180;
        const y2 = (0.5 - centerMy) * 2 * Math.PI;
        this.center.lat = (2 * Math.atan(Math.exp(y2)) - Math.PI / 2) * (180 / Math.PI);
        if (this.heatmapCanvas) {
            const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
            const left = (mercX(this.center.lon) - this.cache.x) * scale - w / 2;
            const top = (mercY(this.center.lat) - this.cache.y) * scale - h / 2;
            if (left < 0 || top < 0 || left + w > this.heatmapCanvas.width || top + h > this.heatmapCanvas.height) this.updateHeatmapCache();
        }
        this.draw();
    }
    setZoom(zoom) {
        this.zoom = zoom;
        this.updateHeatmapCache();
        this.draw();
    }
    setupInteractions() {
        this.canvas.addEventListener('mousedown', (e)=>{
            this.isDragging = true;
            this.dragStart = {
                x: e.clientX,
                y: e.clientY
            };
        });
        window.addEventListener('mousemove', (e)=>{
            if (!this.isDragging) return;
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.dragStart = {
                x: e.clientX,
                y: e.clientY
            };
            this.panBy(dx, dy);
        });
        window.addEventListener('mouseup', ()=>{
            this.isDragging = false;
        });
        this.canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            const zoomDelta = -e.deltaY * 0.002;
            const r = this.canvas.getBoundingClientRect();
            const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
            this.panBy(-ox, -oy);
            this.setZoom(Math.max(1.0, Math.min(10.0, this.zoom + zoomDelta)));
            this.panBy(ox, oy);
        }, {
            passive: false
        });
    }
    getScreenCoords(lon, lat) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
        const mx = mercX(lon);
        const my = mercY(lat);
        return {
            x: w / 2 + (mx - centerMx) * scale,
            y: h / 2 + (my - centerMy) * scale
        };
    }
    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.fillStyle = '#0b1326';
        ctx.fillRect(0, 0, w, h);
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
        ctx.fillStyle = '#182236';
        ctx.strokeStyle = '#23324d';
        ctx.lineWidth = 1;
        const copyMin = Math.floor(centerMx - w / 2 / scale), copyMax = Math.floor(centerMx + w / 2 / scale);
        for(let copy = copyMin; copy <= copyMax; copy++){
            const offsetX = copy * scale;
            for (const poly of this.polygons){
                ctx.beginPath();
                for (const ring of poly){
                    for(let i = 0; i < ring.length; i++){
                        const rx = w / 2 + (ring[i][0] - centerMx) * scale + offsetX;
                        const ry = h / 2 + (ring[i][1] - centerMy) * scale;
                        if (i === 0) ctx.moveTo(rx, ry);
                        else ctx.lineTo(rx, ry);
                    }
                }
                ctx.fill();
                ctx.stroke();
            }
        }
        if (this.heatmapCanvas) {
            ctx.drawImage(this.heatmapCanvas, w / 2 + (this.cache.x - centerMx) * scale, h / 2 + (this.cache.y - centerMy) * scale);
        }
        ctx.restore();
        if (this.onRender) this.onRender();
    }
}
