export const STYLES = [
    {
        id: 'osm-carto',
        url: 'https://tile.yuiseki.net/styles/512/osm-carto.json'
    },
    {
        id: 'osm-liberty',
        url: 'https://tile.yuiseki.net/styles/512/osm-liberty.json'
    },
    {
        id: 'osm-bright',
        url: 'https://tile.yuiseki.net/styles/512/osm-bright.json'
    }
];
const BACKGROUND = '#e9eef2';
const MAX_IN_FLIGHT = 6;
const mercX = (lon)=>(lon + 180) / 360;
const mercY = (lat)=>(1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const invMercY = (my)=>(2 * Math.atan(Math.exp((0.5 - my) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);
export class RasterTileMap {
    canvas;
    ctx;
    center = {
        lon: 139.7671,
        lat: 35.6812
    };
    zoom = 5;
    dpr = 1;
    tileJson = null;
    styleUrl = '';
    attribution = '';
    tiles = new Map();
    pending = new Set();
    queued = new Set();
    queue = [];
    inFlight = 0;
    rafId = 0;
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
    async load(url) {
        const tj = await this.fetchStyle(url);
        this.applyStyle(tj, url);
        if (tj.center) this.center = {
            lon: tj.center[0],
            lat: tj.center[1]
        };
        await this.loadView();
    }
    async setStyle(url) {
        const tj = await this.fetchStyle(url);
        this.applyStyle(tj, url);
        await this.loadView();
    }
    async fetchStyle(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TileJSON ${res.status}`);
        return await res.json();
    }
    applyStyle(tj, url) {
        this.tileJson = tj;
        this.styleUrl = url;
        this.attribution = RasterTileMap.plainText(tj.attribution);
        for (const entry of this.tiles.values())entry.bitmap?.close();
        this.tiles.clear();
        this.queued.clear();
        this.queue.length = 0;
    }
    static plainText(html) {
        return html.replace(/<[^>]*>/g, '').replaceAll('&copy;', '©').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    }
    worldScale() {
        return (this.tileJson?.tileSize ?? 512) * Math.pow(2, this.zoom);
    }
    layout() {
        const tj = this.tileJson;
        if (!tj) return null;
        const W = this.canvas.width;
        const H = this.canvas.height;
        const zi = Math.max(tj.minzoom, Math.min(tj.maxzoom, Math.round(this.zoom)));
        const n = 1 << zi;
        const scale = this.worldScale() * this.dpr;
        const tileDev = scale / n;
        const originX = W / 2 - mercX(this.center.lon) * scale;
        const originY = H / 2 - mercY(this.center.lat) * scale;
        return {
            zi,
            n,
            tileDev,
            originX,
            originY,
            x0: Math.floor(-originX / tileDev),
            x1: Math.floor((W - originX) / tileDev),
            y0: Math.max(0, Math.floor(-originY / tileDev)),
            y1: Math.min(n - 1, Math.floor((H - originY) / tileDev))
        };
    }
    keyOf(z, x, y) {
        const n = 1 << z;
        return `${z}/${(x % n + n) % n}/${y}`;
    }
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.canvas.width = Math.round(w * this.dpr);
        this.canvas.height = Math.round(h * this.dpr);
    }
    panBy(dx, dy) {
        const s = this.worldScale();
        const cx = mercX(this.center.lon) - dx / s;
        const cy = mercY(this.center.lat) - dy / s;
        this.center.lon = cx * 360 - 180;
        this.center.lat = invMercY(cy);
        this.draw();
    }
    setZoom(zoom) {
        this.zoom = Math.max(0, Math.min(20, zoom));
        this.draw();
    }
    zoomAtPoint(x, y, z) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const [mx, my] = this.worldAtScreen(x, y);
        this.zoom = Math.max(0, Math.min(20, z));
        const s = this.worldScale();
        const cx = mx - (x - w / 2) / s;
        const cy = my - (y - h / 2) / s;
        this.center.lon = cx * 360 - 180;
        this.center.lat = invMercY(cy);
        this.draw();
    }
    screenOfWorld(mx, my) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const s = this.worldScale();
        return [
            w / 2 + (mx - mercX(this.center.lon)) * s,
            h / 2 + (my - mercY(this.center.lat)) * s
        ];
    }
    worldAtScreen(x, y) {
        const w = this.canvas.width / this.dpr;
        const h = this.canvas.height / this.dpr;
        const s = this.worldScale();
        return [
            mercX(this.center.lon) + (x - w / 2) / s,
            mercY(this.center.lat) + (y - h / 2) / s
        ];
    }
    tileEdges() {
        const L = this.layout();
        if (!L) return {
            xs: [],
            ys: []
        };
        const xs = [];
        const ys = [];
        for(let x = L.x0; x <= L.x1; x++)xs.push(Math.round(L.originX + (x + 1) * L.tileDev) / this.dpr);
        for(let y = L.y0; y <= L.y1; y++)ys.push(Math.round(L.originY + (y + 1) * L.tileDev) / this.dpr);
        return {
            xs,
            ys
        };
    }
    setupInteractions() {
        this.canvas.addEventListener('pointerdown', (e)=>{
            this.dragging = true;
            this.last = {
                x: e.clientX,
                y: e.clientY
            };
            try {
                this.canvas.setPointerCapture(e.pointerId);
            } catch  {}
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
            const rect = this.canvas.getBoundingClientRect();
            this.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, this.zoom + (e.deltaY < 0 ? 0.4 : -0.4));
        }, {
            passive: false
        });
    }
    draw() {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, W, H);
        const L = this.layout();
        if (!L) return;
        for(let x = L.x0; x <= L.x1; x++){
            const X0 = Math.round(L.originX + x * L.tileDev);
            const X1 = Math.round(L.originX + (x + 1) * L.tileDev);
            for(let y = L.y0; y <= L.y1; y++){
                const Y0 = Math.round(L.originY + y * L.tileDev);
                const Y1 = Math.round(L.originY + (y + 1) * L.tileDev);
                this.blitTile(ctx, L.zi, x, y, X0, Y0, X1 - X0, Y1 - Y0);
            }
        }
        this.ensureVisible(L);
        this.trimCache(L);
    }
    blitTile(ctx, z, x, y, X, Y, W, H) {
        const tj = this.tileJson;
        if (!tj) return;
        for(let dz = 0; dz <= 6; dz++){
            const zz = z - dz;
            if (zz < tj.minzoom) return;
            const f = 1 << dz;
            const ax = Math.floor(x / f);
            const ay = Math.floor(y / f);
            const entry = this.tiles.get(this.keyOf(zz, ax, ay));
            const bm = entry && entry.state === 'ready' ? entry.bitmap : undefined;
            if (!bm) continue;
            const sx = (x - ax * f) / f * bm.width;
            const sy = (y - ay * f) / f * bm.height;
            ctx.drawImage(bm, sx, sy, bm.width / f, bm.height / f, X, Y, W, H);
            return;
        }
    }
    ensureVisible(L) {
        for(let x = L.x0; x <= L.x1; x++){
            for(let y = L.y0; y <= L.y1; y++)this.requestTile(L.zi, x, y);
        }
    }
    requestTile(z, x, y) {
        const key = this.keyOf(z, x, y);
        if (this.tiles.has(key) || this.queued.has(key)) return;
        this.queued.add(key);
        this.queue.push(key);
        this.pump();
    }
    pump() {
        while(this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0){
            const key = this.queue.shift();
            this.queued.delete(key);
            this.startLoad(key);
        }
    }
    startLoad(key) {
        const [zs, xs, ys] = key.split('/');
        const url = this.tileJson.tiles[0].replace('{z}', zs).replace('{x}', xs).replace('{y}', ys);
        const entry = {
            state: 'loading'
        };
        this.tiles.set(key, entry);
        this.inFlight++;
        const job = (async ()=>{
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(String(res.status));
                const bitmap = await createImageBitmap(await res.blob());
                entry.bitmap = bitmap;
                entry.state = 'ready';
            } catch  {
                entry.state = 'error';
            } finally{
                this.inFlight--;
                this.pump();
                this.scheduleDraw();
            }
        })();
        this.pending.add(job);
        void job.finally(()=>this.pending.delete(job));
    }
    scheduleDraw() {
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(()=>{
            this.rafId = 0;
            this.draw();
        });
    }
    trimCache(L) {
        if (this.tiles.size <= 200) return;
        for (const [key, entry] of this.tiles){
            if (this.tiles.size <= 160) break;
            if (entry.state === 'loading') continue;
            const [zs, xs, ys] = key.split('/').map(Number);
            const visible = zs === L.zi && xs >= L.x0 && xs <= L.x1 && ys >= L.y0 && ys <= L.y1;
            if (visible) continue;
            entry.bitmap?.close();
            this.tiles.delete(key);
        }
    }
    async loadView() {
        for(let i = 0; i < 50; i++){
            const L = this.layout();
            if (!L) break;
            this.ensureVisible(L);
            if (this.pending.size === 0 && this.queue.length === 0) break;
            await Promise.all([
                ...this.pending
            ]);
        }
        this.draw();
    }
}
