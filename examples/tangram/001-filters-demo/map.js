const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon)=>(lon + 180) / 360;
const STYLE = {
    SR: {
        color: '#ff7f2a',
        width: 2
    },
    US: {
        color: '#2e9e5b',
        width: 3
    },
    I: {
        color: '#3b6fd4',
        width: 3
    }
};
const DRAW_ORDER = [
    'SR',
    'US',
    'I'
];
export class FiltersMap {
    canvas;
    ctx;
    land = [];
    coast = {
        bbox: [
            0,
            0,
            0,
            0
        ],
        polygons: []
    };
    groups = {
        SR: [],
        US: [],
        I: []
    };
    probes = {
        SR: [
            0,
            0
        ],
        US: [
            0,
            0
        ],
        I: [
            0,
            0
        ]
    };
    visible = {
        SR: true,
        US: true,
        I: true
    };
    center = {
        lon: -122.25,
        lat: 37.6
    };
    zoom = 8;
    dpr = 1;
    dragging = false;
    last = {
        x: 0,
        y: 0
    };
    constructor(canvas){
        this.canvas = canvas;
        const ctx = canvas.getContext('2d', {
            willReadFrequently: true
        });
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
        const [landRes, roadRes, coastRes] = await Promise.all([
            fetch(`${baseDir}/data/baked/tangram-001-filters-demo/land.json`),
            fetch(`${baseDir}/data/baked/tangram-001-filters-demo/roads.json`),
            fetch(`${baseDir}/data/baked/tangram-001-filters-demo/coast.json`)
        ]);
        this.coast = await coastRes.json();
        this.land = await landRes.json();
        const roads = await roadRes.json();
        this.groups = roads.groups;
        this.probes = roads.probes;
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
    setTypeVisible(type, on) {
        this.visible[type] = on;
        this.draw();
    }
    screenFromMercator(mx, my) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const scale = 256 * Math.pow(2, this.zoom);
        return [
            w / 2 + (mx - mercX(this.center.lon)) * scale,
            h / 2 + (my - mercY(this.center.lat)) * scale
        ];
    }
    setupInteractions() {
        this.canvas.addEventListener('pointerdown', (e)=>{
            this.dragging = true;
            this.last = {
                x: e.clientX,
                y: e.clientY
            };
            this.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener('pointermove', (e)=>{
            if (!this.dragging) return;
            const dx = e.clientX - this.last.x;
            const dy = e.clientY - this.last.y;
            this.last = {
                x: e.clientX,
                y: e.clientY
            };
            this.panBy(dx, dy);
        });
        this.canvas.addEventListener('pointerup', (e)=>{
            this.dragging = false;
            try {
                this.canvas.releasePointerCapture(e.pointerId);
            } catch  {}
        });
        this.canvas.addEventListener('wheel', (e)=>{
            e.preventDefault();
            const r = this.canvas.getBoundingClientRect();
            const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
            this.panBy(-ox, -oy);
            this.setZoom(Math.max(1, Math.min(14, this.zoom + (e.deltaY < 0 ? 0.25 : -0.25))));
            this.panBy(ox, oy);
        }, {
            passive: false
        });
    }
    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.fillStyle = '#b8d6e8';
        ctx.fillRect(0, 0, w, h);
        const scale = 256 * Math.pow(2, this.zoom);
        const centerMx = mercX(this.center.lon);
        const centerMy = mercY(this.center.lat);
        const originX = w / 2 - centerMx * scale;
        const originY = h / 2 - centerMy * scale;
        ctx.fillStyle = '#f2efe9';
        ctx.strokeStyle = '#dad7d0';
        ctx.lineWidth = 1;
        const drawLand = (polygons)=>{
            for(let k = Math.floor(centerMx - w / 2 / scale); k <= Math.floor(centerMx + w / 2 / scale); k++){
                for (const poly of polygons){
                    ctx.beginPath();
                    for (const ring of poly){
                        for(let i = 0; i < ring.length; i++){
                            const x = originX + (ring[i][0] + k) * scale;
                            const y = originY + ring[i][1] * scale;
                            if (i === 0) ctx.moveTo(x, y);
                            else ctx.lineTo(x, y);
                        }
                    }
                    ctx.fill();
                    ctx.stroke();
                }
            }
        };
        drawLand(this.land);
        const [x0, y0, x1, y1] = this.coast.bbox.map((v, i)=>(i % 2 ? originY : originX) + v * scale);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        ctx.fillStyle = '#b8d6e8';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.fillStyle = '#f2efe9';
        drawLand(this.coast.polygons);
        ctx.restore();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const type of DRAW_ORDER){
            if (!this.visible[type]) continue;
            const style = STYLE[type];
            ctx.strokeStyle = style.color;
            ctx.lineWidth = style.width;
            ctx.beginPath();
            for (const line of this.groups[type]){
                for(let i = 0; i < line.length; i++){
                    const x = originX + line[i][0] * scale;
                    const y = originY + line[i][1] * scale;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }
}
