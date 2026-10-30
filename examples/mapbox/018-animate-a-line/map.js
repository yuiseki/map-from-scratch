const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
export class MapboxAnimatedLineMap {
    canvas;
    ctx;
    polygons = [];
    route = [];
    center = {
        lon: -98.0,
        lat: 39.0
    };
    zoom = 3.5;
    dpr = 1;
    progress = 0.0;
    isAnimating = true;
    isDragging = false;
    dragStart = {
        x: 0,
        y: 0
    };
    onRender;
    animId = null;
    constructor(canvas, onRender){
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context not available');
        this.ctx = ctx;
        this.onRender = onRender;
        this.resize();
        window.addEventListener('resize', ()=>{
            this.resize();
            this.draw();
        });
        this.setupInteractions();
    }
    async load(baseDir = '../../..') {
        const [landRes, routeRes] = await Promise.all([
            fetch(`${baseDir}/data/baked/mapbox-018-animate-a-line/land.json`),
            fetch(`${baseDir}/data/baked/mapbox-018-animate-a-line/route.json`)
        ]);
        this.polygons = await landRes.json();
        this.route = await routeRes.json();
        this.draw();
    }
    startAnimation() {
        if (this.animId !== null) return;
        const loop = ()=>{
            if (this.isAnimating) {
                this.progress += 0.005;
                if (this.progress > 1.0) this.progress = 0.0;
                this.draw();
            }
            this.animId = requestAnimationFrame(loop);
        };
        this.animId = requestAnimationFrame(loop);
    }
    stopAnimation() {
        if (this.animId !== null) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
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
        this.draw();
    }
    setZoom(zoom) {
        this.zoom = zoom;
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
            this.setZoom(Math.max(2.0, Math.min(8.0, this.zoom + zoomDelta)));
            this.panBy(ox, oy);
        }, {
            passive: false
        });
    }
    getScreenCoords(mx, my) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
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
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        const wrapMin = Math.floor(centerMx - w / 2 / scale), wrapMax = Math.floor(centerMx + w / 2 / scale);
        for(let wrap = wrapMin; wrap <= wrapMax; wrap++){
            for (const poly of this.polygons){
                ctx.beginPath();
                for (const ring of poly){
                    for(let i = 0; i < ring.length; i++){
                        const rx = w / 2 + (ring[i][0] - centerMx) * scale + wrap * scale;
                        const ry = h / 2 + (ring[i][1] - centerMy) * scale;
                        if (i === 0) ctx.moveTo(rx, ry);
                        else ctx.lineTo(rx, ry);
                    }
                }
                ctx.fill();
                ctx.stroke();
            }
        }
        if (this.route.length > 0) {
            ctx.beginPath();
            for(let i = 0; i < this.route.length; i++){
                const pt = this.route[i];
                const sx = w / 2 + (pt[0] - centerMx) * scale;
                const sy = h / 2 + (pt[1] - centerMy) * scale;
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.setLineDash([
                4,
                6
            ]);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.setLineDash([]);
            const visibleCount = Math.max(2, Math.floor(this.route.length * this.progress));
            const activePts = this.route.slice(0, visibleCount);
            ctx.beginPath();
            for(let i = 0; i < activePts.length; i++){
                const pt = activePts[i];
                const sx = w / 2 + (pt[0] - centerMx) * scale;
                const sy = h / 2 + (pt[1] - centerMy) * scale;
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            }
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
            ctx.lineWidth = 7;
            ctx.stroke();
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 3;
            ctx.stroke();
            const headPt = activePts[activePts.length - 1];
            const headSx = w / 2 + (headPt[0] - centerMx) * scale;
            const headSy = h / 2 + (headPt[1] - centerMy) * scale;
            ctx.beginPath();
            ctx.arc(headSx, headSy, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 229, 255, 0.35)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(headSx, headSy, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
            const originPt = this.route[0];
            const origSx = w / 2 + (originPt[0] - centerMx) * scale;
            const origSy = h / 2 + (originPt[1] - centerMy) * scale;
            ctx.beginPath();
            ctx.arc(origSx, origSy, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#38bdf8';
            ctx.fill();
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText('San Francisco', origSx - 35, origSy + 16);
            const destPt = this.route[this.route.length - 1];
            const destSx = w / 2 + (destPt[0] - centerMx) * scale;
            const destSy = h / 2 + (destPt[1] - centerMy) * scale;
            ctx.beginPath();
            ctx.arc(destSx, destSy, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#f43f5e';
            ctx.fill();
            ctx.fillText('Washington D.C.', destSx - 20, destSy + 16);
        }
        ctx.restore();
        if (this.onRender) this.onRender();
    }
}
