const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
export class TangramHighwaysMap {
    canvas;
    ctx;
    polygons = [];
    highways = [];
    coast = {
        bbox: [
            0,
            0,
            0,
            0
        ],
        polygons: []
    };
    paths = null;
    center = {
        lon: -122.4194,
        lat: 37.7749
    };
    zoom = 8;
    dpr = 1;
    isDragging = false;
    dragStart = {
        x: 0,
        y: 0
    };
    onRender;
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
        const [landRes, hwRes, coastRes] = await Promise.all([
            fetch(`${baseDir}/data/baked/tangram-004-highways-demo/land.json`),
            fetch(`${baseDir}/data/baked/tangram-004-highways-demo/highways.json`),
            fetch(`${baseDir}/data/baked/tangram-004-highways-demo/coast.json`)
        ]);
        this.polygons = await landRes.json();
        this.highways = await hwRes.json();
        this.coast = await coastRes.json();
        const [bx0, by0, bx1, by1] = this.coast.bbox;
        const o = [
            (bx0 + bx1) / 2,
            (by0 + by1) / 2
        ];
        const build = (lines, closed)=>{
            const p = new Path2D();
            for (const line of lines){
                line.forEach(([x, y], i)=>i ? p.lineTo(x - o[0], y - o[1]) : p.moveTo(x - o[0], y - o[1]));
                if (closed) p.closePath();
            }
            return p;
        };
        this.paths = {
            land: build(this.polygons.flat(), true),
            coast: build(this.coast.polygons.flat(), true),
            roads: build(this.highways, false),
            glows: this.highways.map((l)=>build([
                    l
                ], false)),
            o
        };
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
            this.setZoom(Math.max(5, Math.min(14, this.zoom + zoomDelta)));
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
        ctx.fillStyle = '#151922';
        ctx.fillRect(0, 0, w, h);
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
        if (!this.paths) {
            ctx.restore();
            return;
        }
        const { land, coast, roads, glows, o } = this.paths;
        const at = (wrap)=>ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * (w / 2 + (o[0] - centerMx + wrap) * scale), this.dpr * (h / 2 + (o[1] - centerMy) * scale));
        ctx.fillStyle = '#1e2430';
        ctx.strokeStyle = '#2e3846';
        ctx.lineWidth = 1 / scale;
        const wrapMin = Math.floor(centerMx - w / 2 / scale), wrapMax = Math.floor(centerMx + w / 2 / scale);
        for(let wrap = wrapMin; wrap <= wrapMax; wrap++){
            at(wrap);
            ctx.fill(land);
            ctx.stroke(land);
        }
        const [bx0, by0, bx1, by1] = this.coast.bbox;
        at(0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(bx0 - o[0], by0 - o[1], bx1 - bx0, by1 - by0);
        ctx.clip();
        ctx.fillStyle = '#151922';
        ctx.fill();
        ctx.fillStyle = '#1e2430';
        ctx.fill(coast);
        ctx.stroke(coast);
        ctx.restore();
        const coreWidth = Math.max(1.0, Math.pow(1.5, this.zoom - 6.0));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = coreWidth * 2.8 / scale;
        for (const glow of glows)ctx.stroke(glow);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = coreWidth / scale;
        ctx.stroke(roads);
        ctx.restore();
        if (this.onRender) this.onRender();
    }
}
