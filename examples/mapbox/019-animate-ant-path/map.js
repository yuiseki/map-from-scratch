const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const DASH = [
    8,
    12
];
const ANT_SPEED = 0.6;
export class MapboxAntPathMap {
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
    dashOffset = 0;
    isAnimating = false;
    isDragging = false;
    dragStart = {
        x: 0,
        y: 0
    };
    animId = null;
    constructor(canvas){
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context not available');
        this.ctx = ctx;
        this.resize();
        window.addEventListener('resize', ()=>{
            this.resize();
            this.draw();
        });
        this.setupInteractions();
    }
    async load(baseDir = '../../..') {
        const [landRes, routeRes] = await Promise.all([
            fetch(`${baseDir}/data/baked/mapbox-019-animate-ant-path/land.json`),
            fetch(`${baseDir}/data/baked/mapbox-019-animate-ant-path/route.json`)
        ]);
        this.polygons = await landRes.json();
        this.route = await routeRes.json();
        this.draw();
    }
    startAnimation() {
        if (this.animId !== null) return;
        const loop = ()=>{
            if (this.isAnimating) {
                this.dashOffset = (this.dashOffset - ANT_SPEED) % (DASH[0] + DASH[1]);
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
        this.zoom = Math.max(2, Math.min(8, zoom));
        this.draw();
    }
    zoomAtPoint(x, y, z) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
        const mx = centerMx + (x - w / 2) / scale;
        const my = centerMy + (y - h / 2) / scale;
        this.zoom = Math.max(2, Math.min(8, z));
        const next = 256 * Math.pow(2, this.zoom);
        this.center.lon = (mx - (x - w / 2) / next) * 360 - 180;
        const cy = my - (y - h / 2) / next;
        this.center.lat = (2 * Math.atan(Math.exp((0.5 - cy) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
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
            const r = this.canvas.getBoundingClientRect();
            const delta = e.deltaY < 0 ? 0.25 : -0.25;
            this.zoomAtPoint(e.clientX - r.left, e.clientY - r.top, this.zoom + delta);
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
    tracePath(scale, centerMx, centerMy, w, h) {
        const ctx = this.ctx;
        ctx.beginPath();
        for(let i = 0; i < this.route.length; i++){
            const pt = this.route[i];
            const sx = w / 2 + (pt[0] - centerMx) * scale;
            const sy = h / 2 + (pt[1] - centerMy) * scale;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
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
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            this.tracePath(scale, centerMx, centerMy, w, h);
            ctx.strokeStyle = '#1d4ed8';
            ctx.lineWidth = 5;
            ctx.stroke();
            this.tracePath(scale, centerMx, centerMy, w, h);
            ctx.setLineDash(DASH);
            ctx.lineDashOffset = this.dashOffset;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.setLineDash([]);
            const ends = [
                [
                    this.route[0],
                    '#22c55e',
                    'San Francisco'
                ],
                [
                    this.route[this.route.length - 1],
                    '#ef4444',
                    'Washington D.C.'
                ]
            ];
            ctx.font = '10px system-ui, sans-serif';
            for (const [pt, color, label] of ends){
                const sx = w / 2 + (pt[0] - centerMx) * scale;
                const sy = h / 2 + (pt[1] - centerMy) * scale;
                ctx.beginPath();
                ctx.arc(sx, sy, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(label, sx - 34, sy + 16);
            }
        }
        ctx.restore();
    }
}
